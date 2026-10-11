/**
 * Generates assets/icon.ico — a valid multi-size Windows ICO file
 * containing 256×256, 48×48, 32×32, and 16×16 images.
 * Uses only Node built-ins (no external dependencies).
 *
 * Icon design: dark pill background with a white swirl/arrow motif,
 * matching the DropZone aesthetic.
 */
const fs = require('fs');
const path = require('path');

// ── Colour palette ────────────────────────────────────────────────────────────
const BG   = { r: 18,  g: 18,  b: 24,  a: 255 }; // #121218 dark pill bg
const ACC  = { r: 124, g: 111, b: 247, a: 255 }; // #7c6ff7 accent purple
const ACC2 = { r: 96,  g: 85,  b: 224, a: 255 }; // #6055e0 deeper purple
const WHT  = { r: 255, g: 255, b: 255, a: 255 }; // white arrow

// ── Draw functions ─────────────────────────────────────────────────────────────

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }

function blendColour(base, over, alpha) {
  const a = alpha / 255;
  return {
    r: lerp(base.r, over.r, a),
    g: lerp(base.g, over.g, a),
    b: lerp(base.b, over.b, a),
    a: 255,
  };
}

function distance(x1, y1, x2, y2) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

/**
 * Renders the DropZone icon into an RGBA pixel buffer of size×size.
 */
function renderIcon(size) {
  const pixels = new Array(size * size);
  const cx = size / 2;
  const cy = size / 2;
  const r  = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;

      // Normalised coords [-1, 1]
      const nx = (x - cx) / r;
      const ny = (y - cy) / r;
      const dist = Math.sqrt(nx * nx + ny * ny);

      // Transparent outside circle
      if (dist > 1.0) {
        pixels[idx] = { r: 0, g: 0, b: 0, a: 0 };
        continue;
      }

      // ── Background: dark circle with subtle radial gradient ──
      const bgBlend = Math.min(1, dist * 0.4);
      let col = {
        r: lerp(BG.r, Math.min(255, BG.r + 12), bgBlend),
        g: lerp(BG.g, Math.min(255, BG.g + 12), bgBlend),
        b: lerp(BG.b, Math.min(255, BG.b + 20), bgBlend),
        a: 255,
      };

      // ── Accent ring near edge ──
      const ringOuter = 0.92;
      const ringInner = 0.78;
      if (dist > ringInner && dist < ringOuter) {
        const t = (dist - ringInner) / (ringOuter - ringInner);
        const ringAlpha = Math.sin(t * Math.PI) * 180;
        col = blendColour(col, ACC, ringAlpha);
      }

      // ── Central swirl / drop-arrow shape ──
      // Draw a downward-pointing arrow with rounded top (like a drop/send icon)
      const s = size;
      // Arrow stem
      const stemW  = s * 0.13;
      const stemTop = cy - s * 0.28;
      const stemBot = cy + s * 0.05;
      const inStem = Math.abs(x - cx) < stemW && y > stemTop && y < stemBot;

      // Arrowhead (triangle pointing down)
      const ahTop  = cy - s * 0.02;
      const ahBot  = cy + s * 0.30;
      const ahHalfW = s * 0.26;
      const progress = (y - ahTop) / (ahBot - ahTop);
      const inArrow = y > ahTop && y < ahBot &&
                      Math.abs(x - cx) < ahHalfW * (1 - progress);

      // Small wifi/broadcast arc above arrow
      const arcCY  = cy - s * 0.28;
      const arcR1  = s * 0.18;
      const arcR2  = s * 0.26;
      const arcAngleRange = Math.PI * 0.7; // ~126°
      const angle = Math.atan2(y - arcCY, x - cx);
      const normAngle = angle + Math.PI / 2; // rotate so 0 is straight up
      const inArc = dist > 0 &&
                    distance(x, y, cx, arcCY) > arcR1 &&
                    distance(x, y, cx, arcCY) < arcR2 &&
                    Math.abs(normAngle) < arcAngleRange / 2;

      if (inStem || inArrow) {
        const aa = dist > 0.85 ? Math.max(0, (1 - dist) / 0.15) : 1;
        col = blendColour(col, WHT, Math.round(aa * 255));
      } else if (inArc) {
        const aa = dist > 0.82 ? Math.max(0, (1 - dist) / 0.18) : 1;
        col = blendColour(col, ACC, Math.round(aa * 220));
        col = blendColour(col, WHT, Math.round(aa * 80));
      }

      // ── Edge anti-alias ──
      if (dist > 0.94) {
        const aa = Math.max(0, (1 - dist) / 0.06);
        col.a = Math.round(aa * 255);
      }

      pixels[idx] = col;
    }
  }
  return pixels;
}

// ── ICO / BMP encoding ─────────────────────────────────────────────────────────

/**
 * Encodes an RGBA pixel array as a 32-bit BMP (BITMAPINFOHEADER) suitable
 * for embedding inside an ICO file.  ICO BMPs store rows bottom-up and
 * include an AND mask appended after the XOR (pixel) data.
 */
function encodeBmpForIco(pixels, size) {
  const pixelDataSize = size * size * 4;       // 32bpp, no padding needed (multiple of 4)
  const andMaskRowBytes = Math.ceil(size / 8); // 1bpp AND mask, padded to 4 bytes per row
  const andMaskRowPadded = Math.ceil(andMaskRowBytes / 4) * 4;
  const andMaskSize = andMaskRowPadded * size;

  const headerSize = 40; // BITMAPINFOHEADER
  const totalSize  = headerSize + pixelDataSize + andMaskSize;
  const buf = Buffer.alloc(totalSize, 0);
  let off = 0;

  // BITMAPINFOHEADER (40 bytes)
  buf.writeUInt32LE(40, off);          off += 4; // biSize
  buf.writeInt32LE(size, off);         off += 4; // biWidth
  buf.writeInt32LE(size * 2, off);     off += 4; // biHeight (×2 for ICO: includes AND mask)
  buf.writeUInt16LE(1, off);           off += 2; // biPlanes
  buf.writeUInt16LE(32, off);          off += 2; // biBitCount
  buf.writeUInt32LE(0, off);           off += 4; // biCompression (BI_RGB)
  buf.writeUInt32LE(pixelDataSize, off); off += 4; // biSizeImage
  buf.writeInt32LE(0, off);            off += 4; // biXPelsPerMeter
  buf.writeInt32LE(0, off);            off += 4; // biYPelsPerMeter
  buf.writeUInt32LE(0, off);           off += 4; // biClrUsed
  buf.writeUInt32LE(0, off);           off += 4; // biClrImportant

  // XOR (pixel) data — rows stored bottom-up, BGRA order
  for (let row = size - 1; row >= 0; row--) {
    for (let col = 0; col < size; col++) {
      const px = pixels[row * size + col];
      buf[off++] = px.b;
      buf[off++] = px.g;
      buf[off++] = px.r;
      buf[off++] = px.a;
    }
  }

  // AND mask — bottom-up, 1bpp: 0 = opaque, 1 = transparent
  // We derive transparency from alpha channel
  for (let row = size - 1; row >= 0; row--) {
    let byteVal = 0;
    let bitPos  = 7;
    let colInRow = 0;
    for (let col = 0; col < andMaskRowPadded * 8; col++) {
      let transparent = 1; // default transparent (for padding bits)
      if (col < size) {
        const px = pixels[row * size + col];
        transparent = px.a < 128 ? 1 : 0;
      }
      byteVal |= (transparent << bitPos);
      bitPos--;
      colInRow++;
      if (bitPos < 0 || col === andMaskRowPadded * 8 - 1) {
        buf[off++] = byteVal;
        byteVal = 0;
        bitPos  = 7;
        colInRow = 0;
      }
    }
  }

  return buf;
}

/**
 * Builds a complete ICO file from multiple sizes.
 * sizes: array of pixel dimensions to include (e.g. [256, 48, 32, 16])
 */
function buildIco(sizes) {
  const bmps = sizes.map(s => {
    const pixels = renderIcon(s);
    return encodeBmpForIco(pixels, s);
  });

  // ICO header: 6 bytes
  // ICONDIRENTRY per image: 16 bytes
  const headerBytes = 6 + sizes.length * 16;
  let imageOffset = headerBytes;

  const headerBuf = Buffer.alloc(headerBytes);
  headerBuf.writeUInt16LE(0, 0);             // reserved
  headerBuf.writeUInt16LE(1, 2);             // type: 1 = icon
  headerBuf.writeUInt16LE(sizes.length, 4);  // image count

  let dirOff = 6;
  for (let i = 0; i < sizes.length; i++) {
    const s = sizes[i];
    const bmpSize = bmps[i].length;
    // Width / Height: 0 means 256 in the ICO spec
    headerBuf.writeUInt8(s >= 256 ? 0 : s, dirOff);     // bWidth
    headerBuf.writeUInt8(s >= 256 ? 0 : s, dirOff + 1); // bHeight
    headerBuf.writeUInt8(0, dirOff + 2);                 // bColorCount (0 = >8bpp)
    headerBuf.writeUInt8(0, dirOff + 3);                 // reserved
    headerBuf.writeUInt16LE(1, dirOff + 4);              // wPlanes
    headerBuf.writeUInt16LE(32, dirOff + 6);             // wBitCount
    headerBuf.writeUInt32LE(bmpSize, dirOff + 8);        // dwBytesInRes
    headerBuf.writeUInt32LE(imageOffset, dirOff + 12);   // dwImageOffset
    dirOff += 16;
    imageOffset += bmpSize;
  }

  return Buffer.concat([headerBuf, ...bmps]);
}

// ── Write the icon ─────────────────────────────────────────────────────────────
const outDir  = path.join(__dirname, '..', 'assets');
const outPath = path.join(outDir, 'icon.ico');

fs.mkdirSync(outDir, { recursive: true });

const ico = buildIco([256, 48, 32, 16]);
fs.writeFileSync(outPath, ico);
console.log(`✅  icon.ico written to ${outPath} (${ico.length} bytes)`);
