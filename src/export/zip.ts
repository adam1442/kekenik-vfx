import { ByteBuilder, StreamCompressor, crc32, utf8, type ByteSink } from './bytes';

/**
 * Small incremental ZIP writer: STORE or DEFLATE (raw deflate through CompressionStream), data descriptors so entries
 * stream without knowing their size, UTF-8 names. ZIP32 only: a hard cap (default 3.5 GiB, user-configurable lower) throws an
 * `ExportCapError` with a clear message instead of producing a corrupt archive. One open entry at a time.
 */
export class ExportCapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportCapError';
  }
}

export const ZIP_HARD_CAP = 3.5 * 1024 * 1024 * 1024;

export interface ZipOutput {
  write(chunk: Uint8Array): Promise<void>;
}
interface CentralEntry {
  name: Uint8Array;
  method: number;
  crc: number;
  csize: number;
  usize: number;
  offset: number;
  time: number;
  date: number;
}

export function dosDateTime(d: Date): { time: number; date: number } {
  const y = Math.max(1980, d.getFullYear());
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

export class ZipWriter {
  private entries: CentralEntry[] = [];
  private offset = 0;
  private open = false;
  private finished = false;
  constructor(private out: ZipOutput, private cap = ZIP_HARD_CAP) {}
  get bytesWritten(): number {
    return this.offset;
  }
  private async emit(b: Uint8Array): Promise<void> {
    if (this.offset + b.length > this.cap) throw new ExportCapError(`ZIP size cap reached (${(this.cap / 1048576).toFixed(0)} MB). Choose a smaller export, or use a browser with the File System Access API (Chrome / Edge) to export into a folder without this limit.`);
    await this.out.write(b);
    this.offset += b.length;
  }
  /** Start an entry; the returned sink must be closed before the next entry starts. */
  beginEntry(name: string, method: 'store' | 'deflate' = 'store', when = new Date()): ByteSink {
    if (this.open) throw new Error('ZipWriter: previous entry is still open');
    if (this.finished) throw new Error('ZipWriter: already finished');
    if (this.entries.length >= 65534) throw new ExportCapError('ZIP: too many files (65534 max)');
    this.open = true;
    const nameBytes = utf8(name.replace(/\\/g, '/'));
    const { time, date } = dosDateTime(when);
    const m = method === 'deflate' ? 8 : 0;
    const startOffset = this.offset;
    let crc = 0;
    let usize = 0;
    let csize = 0;
    let started = false;
    let comp: StreamCompressor | null = null;
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- needed by the nested object literal below
    const self = this;
    const header = async (): Promise<void> => {
      if (started) return;
      started = true;
      const h = new ByteBuilder(30 + nameBytes.length)
        .u32(0x04034b50).u16(20).u16(0x0808).u16(m).u16(time).u16(date).u32(0).u32(0).u32(0).u16(nameBytes.length).u16(0).bytes(nameBytes);
      await self.emit(h.result());
      if (m === 8) comp = new StreamCompressor('deflate-raw', async (c) => { csize += c.length; await self.emit(c); });
    };
    const sink: ByteSink = {
      canSeek: false,
      get position() {
        return usize;
      },
      async write(chunk) {
        await header();
        crc = crc32(chunk, crc);
        usize += chunk.length;
        if (comp) await comp.push(chunk);
        else {
          csize += chunk.length;
          await self.emit(chunk);
        }
      },
      async close() {
        await header();
        if (comp) await (comp as StreamCompressor).finish();
        await self.emit(new ByteBuilder(16).u32(0x08074b50).u32(crc).u32(csize).u32(usize).result());
        self.entries.push({ name: nameBytes, method: m, crc, csize, usize, offset: startOffset, time, date });
        self.open = false;
      },
      async abort() {
        if (comp) await (comp as StreamCompressor).abort();
        self.open = false;
      },
    };
    return sink;
  }
  /** Add a complete in-memory file. */
  async addFile(name: string, data: Uint8Array, method: 'store' | 'deflate' = 'store'): Promise<void> {
    const s = this.beginEntry(name, method);
    await s.write(data);
    await s.close();
  }
  /** Write the central directory. Must be called exactly once. */
  async finish(): Promise<void> {
    if (this.open) throw new Error('ZipWriter: an entry is still open');
    if (this.finished) return;
    this.finished = true;
    const cdStart = this.offset;
    for (const e of this.entries) {
      const b = new ByteBuilder(46 + e.name.length)
        .u32(0x02014b50).u16(20).u16(20).u16(0x0808).u16(e.method).u16(e.time).u16(e.date).u32(e.crc).u32(e.csize).u32(e.usize)
        .u16(e.name.length).u16(0).u16(0).u16(0).u16(0).u32(0).u32(e.offset).bytes(e.name);
      await this.emit(b.result());
    }
    const cdSize = this.offset - cdStart;
    await this.emit(new ByteBuilder(22).u32(0x06054b50).u16(0).u16(0).u16(this.entries.length).u16(this.entries.length).u32(cdSize).u32(cdStart).u16(0).result());
  }
}

/** Reads back the central directory of a ZIP produced here (tests / self-test). STORE and DEFLATE (via DecompressionStream). */
export async function readZip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = bytes.length - 22;
  while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('zip: no end-of-central-directory record');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip: bad central directory entry');
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true);
    const elen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nlen));
    const lnlen = dv.getUint16(lho + 26, true);
    const lelen = dv.getUint16(lho + 28, true);
    const dataStart = lho + 30 + lnlen + lelen;
    let data = bytes.subarray(dataStart, dataStart + csize);
    if (method === 8) {
      const ds = new DecompressionStream('deflate-raw');
      const w = ds.writable.getWriter();
      void w.write(data as Uint8Array<ArrayBuffer>).then(() => w.close());
      const chunks: Uint8Array[] = [];
      const r = ds.readable.getReader();
      for (;;) {
        const { value, done } = await r.read();
        if (done) break;
        chunks.push(value as Uint8Array);
      }
      let n = 0;
      for (const c of chunks) n += c.length;
      data = new Uint8Array(n);
      let o = 0;
      for (const c of chunks) (data.set(c, o), (o += c.length));
    }
    if (data.length !== usize) throw new Error(`zip: size mismatch for ${name}`);
    if (crc32(data) !== crc) throw new Error(`zip: CRC mismatch for ${name}`);
    out.set(name, data.slice());
    p += 46 + nlen + elen + clen;
  }
  return out;
}
