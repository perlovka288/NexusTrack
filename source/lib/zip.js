'use strict';
// NEXUS: потоковая запись ZIP без внешних библиотек (deflate, UTF-8 имена, дескрипторы данных). Файлы до 4 ГБ, до 65 535 файлов.
const fs = require('fs'), path = require('path'), zlib = require('zlib'), {Writable} = require('stream'), {pipeline} = require('stream/promises');

const TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf, prev = 0) { let c = (prev ^ 0xFFFFFFFF) >>> 0; for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function dosTime(d) {
  const y = Math.max(1980, d.getFullYear());
  return {time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()};
}

// entries: [{abs, name}] (name с «/» в качестве разделителя). Возвращает {files, bytes, size}
async function createZip(outFile, entries, {onProgress} = {}) {
  if (entries.length > 65535) throw new Error('Слишком много файлов для одного архива (больше 65 535)');
  const out = fs.createWriteStream(outFile); let offset = 0, bytes = 0; const central = [];
  const failed = new Promise((_, no) => out.once('error', no)); failed.catch(() => {});
  const raw = buf => { offset += buf.length; return out.write(buf) ? null : new Promise(ok => out.once('drain', ok)); };
  try {
    for (const e of entries) {
      const st = await fs.promises.stat(e.abs);
      if (st.size > 0xFFFFFFF0) throw new Error('Файл больше 4 ГБ не помещается в ZIP: ' + e.name);
      const nameBuf = Buffer.from(e.name, 'utf8'), {time, date} = dosTime(st.mtime), hdrOff = offset;
      const lh = Buffer.alloc(30 + nameBuf.length);
      lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0808, 6); lh.writeUInt16LE(8, 8); lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12);
      lh.writeUInt16LE(nameBuf.length, 26); nameBuf.copy(lh, 30);
      await raw(lh);
      let crc = 0, usize = 0, csize = 0;
      const src = fs.createReadStream(e.abs); src.on('data', ch => { crc = crc32(ch, crc); usize += ch.length; });
      await pipeline(src, zlib.createDeflateRaw({level: 6}), new Writable({write(chunk, _enc, cb) { csize += chunk.length; const w = raw(chunk); w ? w.then(() => cb()) : cb(); }}));
      if (offset + csize > 0xFFFFFFF0) throw new Error('Архив больше 4 ГБ');
      const dd = Buffer.alloc(16); dd.writeUInt32LE(0x08074b50, 0); dd.writeUInt32LE(crc, 4); dd.writeUInt32LE(csize, 8); dd.writeUInt32LE(usize, 12);
      await raw(dd);
      central.push({nameBuf, crc, csize, usize, time, date, hdrOff}); bytes += usize;
      if (onProgress) onProgress(central.length, entries.length);
    }
    const cdOff = offset; let cdSize = 0;
    for (const c of central) {
      const h = Buffer.alloc(46 + c.nameBuf.length);
      h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(0x0808, 8); h.writeUInt16LE(8, 10); h.writeUInt16LE(c.time, 12); h.writeUInt16LE(c.date, 14);
      h.writeUInt32LE(c.crc, 16); h.writeUInt32LE(c.csize, 20); h.writeUInt32LE(c.usize, 24); h.writeUInt16LE(c.nameBuf.length, 28); h.writeUInt32LE(c.hdrOff, 42); c.nameBuf.copy(h, 46);
      cdSize += h.length; await raw(h);
    }
    const eo = Buffer.alloc(22); eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(central.length, 8); eo.writeUInt16LE(central.length, 10); eo.writeUInt32LE(cdSize, 12); eo.writeUInt32LE(cdOff, 16);
    await raw(eo);
    await Promise.race([new Promise((ok, no) => { out.end(); out.once('finish', ok); out.once('error', no); }), failed]);
    return {files: central.length, bytes, size: offset};
  } catch (e) { try { out.destroy(); fs.unlinkSync(outFile); } catch {} throw e; }
}
module.exports = {createZip, crc32};
