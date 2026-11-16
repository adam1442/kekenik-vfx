/**
 * Byte-level utilities shared by every encoder: CRC-32, Adler-32, zlib / raw-deflate through the platform
 * CompressionStream (no dependency), a growable byte builder and the streaming `ByteSink` contract.
 * Pure TypeScript: runs in the browser and in Node (vitest).
 */

/* ------------------------------------------------------------------------------------------------ sinks */

/**
 * Where encoded bytes go. Implementations: file stream (File System Access API), incremental ZIP entry, memory.
 * `write` may apply back-pressure (await). `seek` is optional: encoders that need to patch a header (EXR offset table)
 * check `canSeek` and otherwise buffer (bounded) themselves.
 */
export interface ByteSink {
  readonly canSeek: boolean;
  /** Bytes written so far (position of the next `write`, unless seek was used). */
  readonly position: number;
  write(chunk: Uint8Array): Promise<void>;
  /** Overwrite bytes at an absolute position (only when canSeek). The write position afterwards is the END of the file. */
  writeAt?(position: number, chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  /** Abort: discard partial output where possible. */
  abort?(): Promise<void>;
}

/** In-memory sink (tests, small files). `cap` guards against runaway memory. */
export class MemorySink implements ByteSink {
  readonly canSeek = true;
  private parts: Uint8Array[] = [];
  private len = 0;
  private fixed: Map<number, Uint8Array> = new Map();
  closed = false;
  constructor(private cap = 512 * 1024 * 1024) {}
  get position(): number {
    return this.len;
  }
  async write(chunk: Uint8Array): Promise<void> {
    if (this.len + chunk.length > this.cap) throw new Error(`MemorySink: ${this.len + chunk.length} bytes exceed the cap of ${this.cap}`);
    this.parts.push(chunk.slice());
    this.len += chunk.length;
  }
  async writeAt(position: number, chunk: Uint8Array): Promise<void> {
    this.fixed.set(position, chunk.slice());
  }
  async close(): Promise<void> {
    this.closed = true;
  }
  /** Concatenated result with positional patches applied. */
  bytes(): Uint8Array {
    const out = concatBytes(this.parts);
    for (const [pos, c] of this.fixed) out.set(c, pos);
    return out;
  }
}

/* ------------------------------------------------------------------------------------------------ checksums */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** Incremental CRC-32 (IEEE, as used by PNG and ZIP). `crc32(data, prev)` continues a previous value. */
export function crc32(data: Uint8Array, prev = 0): number {
  let c = ~prev >>> 0;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

export function adler32(data: Uint8Array, prev = 1): number {
  let a = prev & 0xffff;
  let b = (prev >>> 16) & 0xffff;
  for (let i = 0; i < data.length; ) {
    const end = Math.min(data.length, i + 3800);
    for (; i < end; i++) {
      a += data[i];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/* ------------------------------------------------------------------------------------------------ compression */

async function pipeThrough(format: 'deflate' | 'deflate-raw', data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream(format);
  const w = cs.writable.getWriter();
  const done = (async () => {
    const chunks: Uint8Array[] = [];
    const r = cs.readable.getReader();
    for (;;) {
      const { value, done: d } = await r.read();
      if (d) break;
      chunks.push(value as Uint8Array);
    }
    return concatBytes(chunks);
  })();
  await w.write(data as Uint8Array<ArrayBuffer>);
  await w.close();
  return done;
}
/** zlib stream (RFC 1950): what PNG IDAT and EXR ZIP blocks need. */
export const deflateZlib = (data: Uint8Array): Promise<Uint8Array> => pipeThrough('deflate', data);
/** Raw deflate (RFC 1951): ZIP entries with method 8. */
export const deflateRaw = (data: Uint8Array): Promise<Uint8Array> => pipeThrough('deflate-raw', data);

/**
 * Streaming compressor: push chunks, receive compressed output through `onData` (back-pressured). Used by the PNG writer so
 * a 16K image never exists in memory in raw or compressed form.
 */
export class StreamCompressor {
  private cs: CompressionStream;
  private writer: WritableStreamDefaultWriter<Uint8Array<ArrayBuffer>>;
  private pump: Promise<void>;
  constructor(format: 'deflate' | 'deflate-raw', onData: (c: Uint8Array) => Promise<void>) {
    this.cs = new CompressionStream(format);
    this.writer = this.cs.writable.getWriter();
    const reader = this.cs.readable.getReader();
    this.pump = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && (value as Uint8Array).length) await onData(value as Uint8Array);
      }
    })();
  }
  async push(chunk: Uint8Array): Promise<void> {
    await this.writer.write(chunk as Uint8Array<ArrayBuffer>);
  }
  async finish(): Promise<void> {
    await this.writer.close();
    await this.pump;
  }
  async abort(): Promise<void> {
    try {
      await this.writer.abort();
    } catch {
      /* already closed */
    }
    await this.pump.catch(() => undefined);
  }
}

/* ------------------------------------------------------------------------------------------------ builders */

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Growable little/big-endian byte writer for headers and small structures. */
export class ByteBuilder {
  private buf: Uint8Array;
  private view: DataView;
  length = 0;
  constructor(initial = 256) {
    this.buf = new Uint8Array(initial);
    this.view = new DataView(this.buf.buffer);
  }
  private ensure(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.length + n) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.length));
    this.buf = nb;
    this.view = new DataView(nb.buffer);
  }
  u8(v: number): this {
    this.ensure(1);
    this.buf[this.length++] = v & 0xff;
    return this;
  }
  u16(v: number, le = true): this {
    this.ensure(2);
    this.view.setUint16(this.length, v, le);
    this.length += 2;
    return this;
  }
  u32(v: number, le = true): this {
    this.ensure(4);
    this.view.setUint32(this.length, v >>> 0, le);
    this.length += 4;
    return this;
  }
  i32(v: number, le = true): this {
    this.ensure(4);
    this.view.setInt32(this.length, v | 0, le);
    this.length += 4;
    return this;
  }
  f32(v: number, le = true): this {
    this.ensure(4);
    this.view.setFloat32(this.length, v, le);
    this.length += 4;
    return this;
  }
  u64(v: number, le = true): this {
    this.ensure(8);
    const lo = v % 4294967296;
    const hi = Math.floor(v / 4294967296);
    if (le) {
      this.view.setUint32(this.length, lo, true);
      this.view.setUint32(this.length + 4, hi, true);
    } else {
      this.view.setUint32(this.length, hi, false);
      this.view.setUint32(this.length + 4, lo, false);
    }
    this.length += 8;
    return this;
  }
  bytes(b: ArrayLike<number>): this {
    this.ensure(b.length);
    this.buf.set(b as ArrayLike<number>, this.length);
    this.length += b.length;
    return this;
  }
  /** ASCII string (no terminator). */
  ascii(s: string): this {
    this.ensure(s.length);
    for (let i = 0; i < s.length; i++) this.buf[this.length++] = s.charCodeAt(i) & 0x7f;
    return this;
  }
  /** Null-terminated ASCII string. */
  cstr(s: string): this {
    return this.ascii(s).u8(0);
  }
  pad(alignment: number, fill = 0): this {
    while (this.length % alignment) this.u8(fill);
    return this;
  }
  result(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Fresh ArrayBuffer-backed copy (satisfies BlobPart typing under TS 5.9 lib.dom). */
export const toBlobPart = (u: Uint8Array): Uint8Array<ArrayBuffer> => u.slice() as Uint8Array<ArrayBuffer>;
