import { Buffer } from 'node:buffer';

/** Contenido guardado por error como JSON.stringify(Buffer.toJSON()). */
function unwrapJsonSerializedNodeBuffer(bytes: Buffer): Buffer {
  if (bytes.length < 15 || bytes[0] !== 0x7b /* { */) return bytes;
  try {
    const txt = bytes.toString('utf8');
    if (!txt.startsWith('{"type":"Buffer"')) return bytes;
    const j = JSON.parse(txt) as { type?: string; data?: unknown };
    if (j?.type === 'Buffer' && Array.isArray(j.data)) {
      const data = j.data as unknown[];
      if (data.every((x) => typeof x === 'number' && x >= 0 && x <= 255)) {
        return Buffer.from(data as number[]);
      }
    }
  } catch {
    /* ignore */
  }
  return bytes;
}

/** Decodifica `bytea` tal como suele llegar desde PostgREST / supabase-js. */
export function byteaValueToBuffer(v: unknown): Buffer | null {
  if (v == null) return null;
  if (typeof v === 'object' && v !== null && 'type' in v) {
    const t = (v as { type?: string }).type;
    const data = (v as { data?: unknown }).data;
    if (t === 'Buffer' && Array.isArray(data)) {
      const nums = data as unknown[];
      if (nums.every((x) => typeof x === 'number' && x >= 0 && x <= 255)) {
        return unwrapJsonSerializedNodeBuffer(Buffer.from(nums as number[]));
      }
    }
  }
  if (Buffer.isBuffer(v)) return unwrapJsonSerializedNodeBuffer(v);
  if (v instanceof Uint8Array) return unwrapJsonSerializedNodeBuffer(Buffer.from(v));
  if (typeof v === 'string') {
    if (v.startsWith('\\x')) {
      try {
        return unwrapJsonSerializedNodeBuffer(Buffer.from(v.slice(2), 'hex'));
      } catch {
        return null;
      }
    }
    try {
      return unwrapJsonSerializedNodeBuffer(Buffer.from(v, 'base64'));
    } catch {
      return null;
    }
  }
  return null;
}
