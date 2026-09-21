'use strict';

/**
 * Draws the pictures the showcase page uses, so the store screenshots never
 * borrow an image from anywhere. Each one is a gradient landscape with a few
 * shapes over it: recognisably a photograph at a glance, and unmistakably
 * blurred once the extension covers it.
 *
 *   node tools/make-showcase-images.js
 *
 * The output is committed, so this only needs running when the set changes.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PAGES = path.join(__dirname, 'pages');

/** A minimal PNG writer: 8 bit RGB, one IDAT, no interlacing. */
function png(width, height, pixels) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0;
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 3;
      raw[offset] = pixels[from];
      raw[offset + 1] = pixels[from + 1];
      raw[offset + 2] = pixels[from + 2];
      offset += 3;
    }
  }

  const table = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }

  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, checksum]);
  };

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const mix = (a, b, t) => Math.round(a + (b - a) * Math.min(1, Math.max(0, t)));

/**
 * A landscape: sky washing into ground, a sun, and hills whose crests are drawn
 * from a couple of sine waves so no two pictures look alike.
 */
function landscape(width, height, palette, seed) {
  const pixels = Buffer.alloc(width * height * 3);
  const horizon = height * palette.horizon;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 3;
      let colour;

      if (y < horizon) {
        const t = y / horizon;
        colour = [
          mix(palette.skyTop[0], palette.skyBottom[0], t),
          mix(palette.skyTop[1], palette.skyBottom[1], t),
          mix(palette.skyTop[2], palette.skyBottom[2], t)
        ];

        const dx = x - width * palette.sunX;
        const dy = y - horizon * palette.sunY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const radius = Math.min(width, height) * 0.12;
        if (distance < radius) {
          const glow = 1 - distance / radius;
          colour = [
            mix(colour[0], palette.sun[0], glow),
            mix(colour[1], palette.sun[1], glow),
            mix(colour[2], palette.sun[2], glow)
          ];
        }
      } else {
        const t = (y - horizon) / (height - horizon);
        colour = [
          mix(palette.groundTop[0], palette.groundBottom[0], t),
          mix(palette.groundTop[1], palette.groundBottom[1], t),
          mix(palette.groundTop[2], palette.groundBottom[2], t)
        ];
      }

      for (let hill = 0; hill < palette.hills.length; hill += 1) {
        const shape = palette.hills[hill];
        const phase = seed * (hill + 1);
        const crest = horizon
          + Math.sin(x / (width * shape.wavelength) + phase) * height * shape.height
          + Math.sin(x / (width * shape.wavelength * 0.37) + phase * 2) * height * shape.height * 0.4
          - height * shape.lift;
        if (y > crest) {
          colour = [
            mix(colour[0], shape.colour[0], 0.85),
            mix(colour[1], shape.colour[1], 0.85),
            mix(colour[2], shape.colour[2], 0.85)
          ];
        }
      }

      pixels[at] = colour[0];
      pixels[at + 1] = colour[1];
      pixels[at + 2] = colour[2];
    }
  }

  return png(width, height, pixels);
}

/** A portrait stand in: head and shoulders over a flat ground. */
function portrait(size, palette) {
  const pixels = Buffer.alloc(size * size * 3);
  const centre = size / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const at = (y * size + x) * 3;
      let colour = palette.background;

      const shoulderY = size * 0.78;
      const shoulderWidth = size * 0.42;
      if (y > shoulderY - ((x - centre) * (x - centre)) / shoulderWidth) {
        colour = palette.clothes;
      }

      const dx = (x - centre) / (size * 0.21);
      const dy = (y - size * 0.44) / (size * 0.25);
      if (dx * dx + dy * dy < 1) {
        colour = palette.skin;
      }

      const hairDx = (x - centre) / (size * 0.23);
      const hairDy = (y - size * 0.36) / (size * 0.22);
      if (hairDx * hairDx + hairDy * hairDy < 1 && y < size * 0.4) {
        colour = palette.hair;
      }

      pixels[at] = colour[0];
      pixels[at + 1] = colour[1];
      pixels[at + 2] = colour[2];
    }
  }

  return png(size, size, pixels);
}

const HILLS = (colour) => [
  { wavelength: 0.5, height: 0.05, lift: 0.02, colour },
  { wavelength: 0.23, height: 0.03, lift: -0.06, colour: colour.map((c) => Math.round(c * 0.7)) }
];

const IMAGES = [
  ['showcase-hero.png', () => landscape(1200, 520, {
    horizon: 0.62,
    skyTop: [38, 60, 120], skyBottom: [226, 146, 96],
    groundTop: [78, 72, 96], groundBottom: [26, 28, 44],
    sun: [255, 228, 170], sunX: 0.72, sunY: 0.78,
    hills: HILLS([44, 52, 84])
  }, 1.1)],
  ['showcase-one.png', () => landscape(640, 400, {
    horizon: 0.55,
    skyTop: [118, 178, 214], skyBottom: [216, 232, 236],
    groundTop: [96, 132, 118], groundBottom: [38, 62, 62],
    sun: [255, 250, 230], sunX: 0.25, sunY: 0.5,
    hills: HILLS([58, 92, 96])
  }, 2.4)],
  ['showcase-two.png', () => landscape(640, 400, {
    horizon: 0.48,
    skyTop: [206, 158, 122], skyBottom: [244, 214, 176],
    groundTop: [150, 122, 84], groundBottom: [72, 56, 40],
    sun: [255, 236, 196], sunX: 0.62, sunY: 0.86,
    hills: HILLS([116, 92, 66])
  }, 3.7)],
  ['showcase-three.png', () => landscape(640, 400, {
    horizon: 0.6,
    skyTop: [58, 46, 92], skyBottom: [154, 104, 148],
    groundTop: [64, 48, 76], groundBottom: [24, 20, 36],
    sun: [248, 214, 196], sunX: 0.4, sunY: 0.68,
    hills: HILLS([48, 38, 66])
  }, 5.2)],
  ['showcase-face-one.png', () => portrait(200, {
    background: [206, 214, 226], clothes: [72, 92, 132], skin: [226, 186, 158], hair: [88, 66, 52]
  })],
  ['showcase-face-two.png', () => portrait(200, {
    background: [224, 214, 206], clothes: [122, 82, 72], skin: [176, 132, 104], hair: [44, 36, 34]
  })]
];

for (const [name, draw] of IMAGES) {
  const file = path.join(PAGES, name);
  fs.writeFileSync(file, draw());
  console.log('wrote pages/' + name + ' (' + Math.round(fs.statSync(file).size / 1024) + ' kB)');
}
