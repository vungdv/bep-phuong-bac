/** W3C Trace Context `traceparent` (version 00, sampled flag 01). */

type RandomBytes = (n: number) => Uint8Array;

const defaultRandom: RandomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

function nonZeroId(random: RandomBytes, bytes: number): string {
  for (let i = 0; i < 8; i++) {
    const id = hex(random(bytes).subarray(0, bytes));
    if (/[1-9a-f]/.test(id) && id.length === bytes * 2) return id;
  }
  return '0'.repeat(bytes * 2 - 1) + '1'; // all-zero ids are invalid; fall back to a fixed non-zero one
}

/** `00-<32 hex trace-id>-<16 hex parent-id>-01`, ids never all zero. */
export function createTraceparent(random: RandomBytes = defaultRandom): string {
  return `00-${nonZeroId(random, 16)}-${nonZeroId(random, 8)}-01`;
}
