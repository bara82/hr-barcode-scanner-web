/* =========================================================
   qrimage.js - turns a QR module matrix into a real PNG file (no canvas, no DOM).
   Why: an inline <svg> cannot be long-pressed / "saved as image" on phones, and a canvas needs a browser.
   A hand-written PNG works everywhere, is byte-identical in Node tests, and is always black on white
   with a 4-module quiet zone, so it scans the same in dark mode and when saved to the photo library.

   qr = anything with getModuleCount() and isDark(row, col) (qrcode-generator objects qualify).
========================================================= */
(function (root) {
  'use strict';

  let crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        crcTable[n] = c >>> 0;
      }
    }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function adler32(bytes) {
    let a = 1, b = 0;
    for (let i = 0; i < bytes.length; i++) {
      a = (a + bytes[i]) % 65521;
      b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
  }

  function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }

  function chunk(type, data) {
    const body = new Uint8Array(4 + data.length);
    for (let i = 0; i < 4; i++) body[i] = type.charCodeAt(i);
    body.set(data, 4);
    return [Uint8Array.from(u32(data.length)), body, Uint8Array.from(u32(crc32(body)))];
  }

  // zlib stream made of "stored" (uncompressed) deflate blocks: tiny code, valid for every PNG decoder
  function zlibStored(raw) {
    const blocks = Math.max(1, Math.ceil(raw.length / 65535));
    const out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
    let o = 0;
    out[o++] = 0x78; out[o++] = 0x01;
    for (let i = 0; i < blocks; i++) {
      const start = i * 65535, len = Math.min(65535, raw.length - start), last = i === blocks - 1 ? 1 : 0;
      out[o++] = last;
      out[o++] = len & 255; out[o++] = len >>> 8;
      out[o++] = ~len & 255; out[o++] = (~len >>> 8) & 255;
      out.set(raw.subarray(start, start + len), o);
      o += len;
    }
    out.set(u32(adler32(raw)), o);
    return out;
  }

  /**
   * @returns {Uint8Array} PNG file bytes (1-bit grayscale, black modules on white)
   * @param opts.quiet   quiet-zone width in modules (default 4, the QR standard)
   * @param opts.minSize smallest image side in pixels (default 600) - the module size is an integer
   */
  function qrToPng(qr, opts) {
    opts = opts || {};
    const quiet = opts.quiet == null ? 4 : opts.quiet;
    const minSize = opts.minSize || 600;
    const n = qr.getModuleCount();
    const total = n + 2 * quiet;
    const scale = Math.max(1, Math.ceil(minSize / total));
    const size = total * scale;
    const rowBytes = Math.ceil(size / 8);

    const raw = new Uint8Array((rowBytes + 1) * size);        // each row: filter byte 0 + packed bits (1 = white)
    for (let y = 0; y < size; y++) {
      const mr = Math.floor(y / scale) - quiet;
      const base = y * (rowBytes + 1);
      for (let b = 0; b < rowBytes; b++) raw[base + 1 + b] = 0xFF;
      if (mr < 0 || mr >= n) continue;
      for (let x = 0; x < size; x++) {
        const mc = Math.floor(x / scale) - quiet;
        if (mc >= 0 && mc < n && qr.isDark(mr, mc)) raw[base + 1 + (x >> 3)] &= ~(0x80 >> (x & 7));
      }
    }

    const ihdr = Uint8Array.from([...u32(size), ...u32(size), 1, 0, 0, 0, 0]);   // 1-bit, grayscale
    const parts = [
      Uint8Array.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
      ...chunk('IHDR', ihdr),
      ...chunk('IDAT', zlibStored(raw)),
      ...chunk('IEND', new Uint8Array(0))
    ];
    const total2 = parts.reduce((s, p) => s + p.length, 0);
    const png = new Uint8Array(total2);
    let o = 0;
    for (const p of parts) { png.set(p, o); o += p.length; }
    return png;
  }

  function bytesToBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return (typeof btoa === 'function') ? btoa(s) : Buffer.from(bytes).toString('base64');
  }

  function pngToDataUrl(bytes) { return 'data:image/png;base64,' + bytesToBase64(bytes); }

  // "Čistoća Šibenik" -> "cistoca-sibenik" (safe file name part)
  function fileSlug(text, maxLen) {
    const s = String(text || '')
      .replace(/[Đđ]/g, 'd')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return s.slice(0, maxLen || 40).replace(/-+$/, '');
  }

  const api = { qrToPng, pngToDataUrl, fileSlug };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
