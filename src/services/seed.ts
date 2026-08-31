/**
 * Deterministic stand-in for randomness.
 *
 * Remotion renders each frame independently and must produce the same picture
 * every time, so `Math.random` is not available to us. Variation instead comes
 * from hashing the scene id.
 *
 * This module must stay free of Node built-ins and of `dotenv`: Remotion
 * bundles the components for the browser, and a Node import reaching that
 * bundle breaks it.
 */

/** FNV-1a over the id, returned as an unsigned 32-bit integer. */
export function seedFromId(id: string): number {
  let hash = 2166136261;

  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

/**
 * The nth draw from a seed, in [0, 1).
 *
 * The index is mixed into the seed before the avalanche rather than added to
 * it afterwards. Scene ids differ only in their final character, and a weaker
 * mix leaves the first draw of every scene clustered together, which would
 * make every scene of a video look alike.
 */
export function seededUnit(seed: number, index: number): number {
  let x = Math.imul(seed ^ Math.imul(index + 1, 0x9e3779b1), 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;

  return (x >>> 0) / 4294967296;
}
