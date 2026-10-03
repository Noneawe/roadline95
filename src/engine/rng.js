// Seedable deterministic RNG (mulberry32) and FNV-1a hashing.
// Used by generators and gameplay; never use Math.random where determinism matters.

/**
 * Creates a deterministic RNG returning floats in [0, 1).
 * @param {number} seed
 * @returns {() => number}
 */
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * FNV-1a hash of a string.
 * @param {string} s
 * @returns {number} unsigned 32-bit hash
 */
export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * FNV-1a hash of a byte array.
 * @param {Uint8Array} bytes
 * @returns {number} unsigned 32-bit hash
 */
export function hashBytes(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
  return h >>> 0;
}
