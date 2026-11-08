/** JSON for the web transport. Bytes and undefined arguments survive the trip. */

const TAG = '$hws';

const CHUNK = 0x8000;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodeWire(value: unknown): string {
  return JSON.stringify(value, function replace(this: unknown, key: string, encoded: unknown) {

    // Buffer defines toJSON, so the holder has the original where `encoded` does not.
    const original = (this as Record<string, unknown>)[key];
    if (original instanceof Uint8Array) return { [TAG]: 'u8', b: toBase64(original) };
    if (original === undefined && Array.isArray(this)) return { [TAG]: 'undefined' };
    return encoded;
  });
}

export function decodeWire(text: string): unknown {
  return JSON.parse(text, (_key, value: unknown) => {
    if (typeof value !== 'object' || value === null || !(TAG in value)) return value;
    const tagged = value as { [TAG]: string; b?: string };
    if (tagged[TAG] === 'u8') return fromBase64(tagged.b ?? '');
    if (tagged[TAG] === 'undefined') return undefined;
    throw new Error(`unknown wire tag: ${tagged[TAG]}`);
  });
}
