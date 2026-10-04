// Generador de iconos PNG 192x192 y 512x512 usando zlib nativo de Node.js (cero dependencias externas)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createSolidColorPng(width, height, r, g, b, a = 255) {
  // Cada scanline comienza con un byte de filtro (0 = None) seguido de RGBA por pixel
  const rowSize = 1 + width * 4;
  const rawData = Buffer.alloc(rowSize * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // Filter byte: None

    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;

      // Dibujar un borde redondeado o cuadrado suave con icono estilizado
      // Radio de borde 25% de la dimensión
      const cornerR = width * 0.22;
      const dx = Math.min(x, width - 1 - x);
      const dy = Math.min(y, height - 1 - y);

      let isInside = true;
      if (dx < cornerR && dy < cornerR) {
        const distSq = (cornerR - dx) * (cornerR - dx) + (cornerR - dy) * (cornerR - dy);
        if (distSq > cornerR * cornerR) {
          isInside = false;
        }
      }

      if (!isInside) {
        // Transparente fuera del borde redondeado
        rawData[pxOffset] = 0;
        rawData[pxOffset + 1] = 0;
        rawData[pxOffset + 2] = 0;
        rawData[pxOffset + 3] = 0;
        continue;
      }

      // Dibujar un sutil gradiente azul de fondo
      const grad = Math.floor((y / height) * 35);
      const pr = Math.max(0, r - grad);
      const pg = Math.max(0, g - grad);
      const pb = Math.min(255, b + grad);

      // Dibujar una silueta de casa/caja blanca en el centro
      const cx = width / 2;
      const cy = height / 2;
      const distFromCenter = Math.hypot(x - cx, y - cy);

      // Icono esquemático en el centro
      const inBox = (Math.abs(x - cx) < width * 0.22) && (y > cy - height * 0.05 && y < cy + height * 0.26);
      const inRoof = (y <= cy - height * 0.05) && (y >= cy - height * 0.28) && (Math.abs(x - cx) <= (cy - height * 0.05 - y) * 1.1 + width * 0.04);

      if (inBox || inRoof) {
        // Blanco puro con sombra sutil
        rawData[pxOffset] = 255;
        rawData[pxOffset + 1] = 255;
        rawData[pxOffset + 2] = 255;
        rawData[pxOffset + 3] = 255;
      } else {
        rawData[pxOffset] = pr;
        rawData[pxOffset + 1] = pg;
        rawData[pxOffset + 2] = pb;
        rawData[pxOffset + 3] = a;
      }
    }
  }

  const compressedData = zlib.deflateSync(rawData);

  // Construcción de chunks PNG (IHDR, IDAT, IEND)
  function createChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);

    const typeBuf = Buffer.from(type, 'ascii');
    const toCrc = Buffer.concat([typeBuf, data]);

    const crc = crc32(toCrc);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc >>> 0, 0);

    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  // PNG Header
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // Bit depth: 8
  ihdrData[9] = 6; // Color type: 6 (RGBA)
  ihdrData[10] = 0; // Compression: 0
  ihdrData[11] = 0; // Filter: 0
  ihdrData[12] = 0; // Interlace: 0

  const ihdrChunk = createChunk('IHDR', ihdrData);
  const idatChunk = createChunk('IDAT', compressedData);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Tabla CRC32
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) c = 0xedb88320 ^ (c >>> 1);
    else c = c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return c ^ 0xffffffff;
}

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Azul primario #2563eb (R: 37, G: 99, B: 235)
const png192 = createSolidColorPng(192, 192, 37, 99, 235);
fs.writeFileSync(path.join(iconsDir, 'icon-192.png'), png192);

const png512 = createSolidColorPng(512, 512, 37, 99, 235);
fs.writeFileSync(path.join(iconsDir, 'icon-512.png'), png512);

console.log('Iconos PNG 192x192 y 512x512 generados con éxito.');
