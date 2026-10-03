// Runs tests/render.html in headless Chrome (SwiftShader WebGL2) through a built-in static server.
// Prints the results table; with --update rewrites tools/golden/*.bin from the current render.
// Usage: node tools/render-test.mjs [--update] [--page=index.html?...] (CHROME=/path/to/chrome overrides the browser)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const update = process.argv.includes('--update');
const pageArg = process.argv.find((a) => a.startsWith('--page='));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.bin': 'application/octet-stream' };

/**
 * Serves the project directory on a random local port.
 * @returns {Promise<http.Server>}
 */
export function serve() {
  const server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

/**
 * Loads a URL in headless Chrome and returns the serialized DOM after scripts settle.
 * @param {string} url
 * @returns {Promise<string>}
 */
export async function dumpDom(url) {
  const chrome = process.env.CHROME || ['google-chrome', 'chromium', 'chromium-browser'].find((c) => {
    try { execFileSync('which', [c], { stdio: 'ignore' }); return true; } catch { return false; }
  });
  if (!chrome) throw new Error('Chrome/Chromium not found (set CHROME)');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rl95-'));
  try {
    const { stdout } = await promisify(execFile)(chrome, [
      '--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
      '--no-first-run', `--user-data-dir=${profile}`, '--virtual-time-budget=120000', '--dump-dom', url,
    ], { encoding: 'utf8', maxBuffer: 64 << 20, timeout: 300000 });
    return stdout;
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

const strip = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ');

async function main() {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  try {
    if (pageArg) {
      process.stdout.write(await dumpDom(base + pageArg.slice(7)));
      return;
    }
    const html = await dumpDom(`${base}tests/render.html${update ? '?dump=1' : ''}`);
    const table = html.match(/<table id="results">([\s\S]*?)<\/table>/);
    for (const tr of (table ? table[1] : '').split('</tr>')) {
      const line = strip(tr).trim();
      if (line) process.stdout.write(`${line}\n`);
    }
    if (update) {
      const dump = html.match(/<pre id="dump">([\s\S]*?)<\/pre>/)[1].trim();
      fs.mkdirSync(path.join(root, 'tools/golden'), { recursive: true });
      for (const line of dump.split('\n')) {
        const [name, b64] = line.split(':');
        fs.writeFileSync(path.join(root, 'tools/golden', `${name}.bin`), Buffer.from(b64, 'base64'));
        process.stdout.write(`updated tools/golden/${name}.bin\n`);
      }
    }
    if (update) return;
    const result = (html.match(/data-result="(\w+)"/) || [])[1] || 'NO RESULT';
    process.stdout.write(`\nrender tests: ${result}\n`);
    if (result !== 'PASS') process.exitCode = 1;
  } finally {
    server.close();
  }
}

main().catch((e) => { process.stderr.write(`${e.stack}\n`); process.exit(1); });
