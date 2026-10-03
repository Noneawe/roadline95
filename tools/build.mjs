// Bundles src/main.js and its ES module graph into one self-contained dist/roadline95.html
// that runs from file://. Each module becomes a function scope; imports/exports become plain consts.
// Run: node tools/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BYTES = 2 * 1024 * 1024;
const modules = new Map();
const order = [];

function importToConst(what, id) {
  what = what.trim();
  const ns = what.match(/^\*\s+as\s+(\w+)$/);
  if (ns) return `const ${ns[1]} = ${id};`;
  const named = what.match(/^\{([\s\S]*)\}$/);
  if (!named) throw new Error(`Unsupported import form: ${what}`);
  const list = named[1].split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/\s+as\s+/, ': '));
  return `const { ${list.join(', ')} } = ${id};`;
}

function visit(file) {
  if (modules.has(file)) return modules.get(file).id;
  const id = `__m${modules.size}`;
  modules.set(file, { id });
  const names = [];
  let code = fs.readFileSync(file, 'utf8');
  code = code.replace(/^import\s+([\s\S]*?)\s+from\s+['"](.+?)['"];?/gm, (_, what, spec) =>
    importToConst(what, visit(path.resolve(path.dirname(file), spec))));
  code = code.replace(/^export\s+(const|let|class|function\*?|async\s+function)\s+([\w$]+)/gm, (_, kw, name) => {
    names.push(name);
    return `${kw} ${name}`;
  });
  code = code.replace(/^export\s*\{([^}]*)\};?/gm, (_, list) => {
    for (const s of list.split(',').map((x) => x.trim()).filter(Boolean)) {
      const [local, exported] = s.split(/\s+as\s+/);
      names.push(exported ? `${exported}: ${local}` : local);
    }
    return '';
  });
  if (/^\s*(import|export)\s/m.test(code)) throw new Error(`Unhandled import/export in ${path.relative(root, file)}`);
  modules.get(file).code = `// ${path.relative(root, file)}\nconst ${id} = (() => {\n${code}\nreturn { ${names.join(', ')} };\n})();`;
  order.push(file);
  return id;
}

visit(path.join(root, 'src/main.js'));
const bundle = order.map((f) => modules.get(f).code).join('\n\n').replace(/<\/script/gi, '<\\/script');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const tag = '<script type="module" src="src/main.js"></script>';
if (!html.includes(tag)) throw new Error('index.html: main script tag not found');
const out = html.replace(tag, () => `<script type="module">\n${bundle}\n</script>`);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/roadline95.html'), out);
const size = Buffer.byteLength(out);
process.stdout.write(`dist/roadline95.html: ${order.length} modules, ${(size / 1024).toFixed(1)} KiB\n`);
if (size > MAX_BYTES) {
  process.stderr.write('Build exceeds the 2 MB budget\n');
  process.exit(1);
}
