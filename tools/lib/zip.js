'use strict';

/**
 * Writes a ZIP archive with no dependencies, because a build that pulls a
 * package tree in to compress twenty files is a supply chain the extension
 * does not otherwise have.
 *
 * Only what the format needs for this job: one deflated entry per file, no
 * directory entries, no zip64 (the package is measured in kilobytes) and no
 * encryption. That is exactly the subset the Chrome Web Store unpacks.
 */

const zlib = require('zlib');

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;

/** Deflate, and the version of the spec that first required it. */
const METHOD_DEFLATE = 8;
const VERSION_NEEDED = 20;

/**
 * General purpose bit 11: the entry name is UTF-8 rather than the code page the
 * reader happens to guess. Names are written with Buffer.from(name, "utf8"), so
 * saying so is simply the truth, and it is what keeps a non ASCII file name
 * from arriving mangled.
 */
const FLAG_UTF8_NAMES = 0x0800;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

/**
 * ZIP still stores the MS-DOS timestamp of 1980: two bytes of date, two of
 * time, with seconds in steps of two. Read in UTC, so a fixed date produces the
 * same two bytes on a machine in any time zone.
 */
function dosTime(date) {
  const time = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1);
  const day = ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  return { time, day };
}

/**
 * Builds the archive in memory and returns it.
 *
 * @param {{name: string, data: Buffer, date?: Date}[]} entries
 *        name is the path inside the archive, always with forward slashes.
 */
function create(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name.split('\\').join('/'), 'utf8');
    const data = entry.data;
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const checksum = crc32(data);
    const { time, day } = dosTime(entry.date || new Date());

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(LOCAL_HEADER, 0);
    local.writeUInt16LE(VERSION_NEEDED, 4);
    local.writeUInt16LE(FLAG_UTF8_NAMES, 6);
    local.writeUInt16LE(METHOD_DEFLATE, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(CENTRAL_HEADER, 0);
    central.writeUInt16LE(VERSION_NEEDED, 4);
    central.writeUInt16LE(VERSION_NEEDED, 6);
    central.writeUInt16LE(FLAG_UTF8_NAMES, 8);
    central.writeUInt16LE(METHOD_DEFLATE, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    locals.push(local, compressed);
    centrals.push(central);
    offset += local.length + compressed.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, directory, end]);
}

module.exports = { create, crc32 };
