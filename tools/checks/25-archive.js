'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const zip = require('../lib/zip');

const ROOT = path.join(__dirname, '..', '..');

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;

/**
 * Reads an archive back out of the bytes, from the format rather than from the
 * writer: the central directory says where each entry begins, the local header
 * there says how long it is, and the data is inflated with the inverse of what
 * wrote it.
 */
function read(archive) {
  const end = archive.length - 22;
  if (archive.readUInt32LE(end) !== END_OF_CENTRAL) {
    throw new Error('no end of central directory record where one has to be');
  }

  const total = archive.readUInt16LE(end + 10);
  const directorySize = archive.readUInt32LE(end + 12);
  const directoryOffset = archive.readUInt32LE(end + 16);

  const entries = [];
  let at = directoryOffset;
  for (let i = 0; i < total; i += 1) {
    if (archive.readUInt32LE(at) !== CENTRAL_HEADER) {
      throw new Error('entry ' + i + ' is not where the directory says it is');
    }
    const flags = archive.readUInt16LE(at + 8);
    const crc = archive.readUInt32LE(at + 16);
    const compressedSize = archive.readUInt32LE(at + 20);
    const size = archive.readUInt32LE(at + 24);
    const nameLength = archive.readUInt16LE(at + 28);
    const extraLength = archive.readUInt16LE(at + 30);
    const commentLength = archive.readUInt16LE(at + 32);
    const localOffset = archive.readUInt32LE(at + 42);
    const name = archive.toString('utf8', at + 46, at + 46 + nameLength);

    if (archive.readUInt32LE(localOffset) !== LOCAL_HEADER) {
      throw new Error(name + ' does not begin where the directory says');
    }
    const localName = archive.readUInt16LE(localOffset + 26);
    const localExtra = archive.readUInt16LE(localOffset + 28);
    const from = localOffset + 30 + localName + localExtra;
    const data = zlib.inflateRawSync(archive.subarray(from, from + compressedSize));

    entries.push({ name, flags, crc, size, data });
    at += 46 + nameLength + extraLength + commentLength;
  }

  return { entries, total, directoryEndsAt: at, directoryOffset, directorySize, endsAt: end };
}

/** General purpose bit 11: the entry names are UTF-8. */
const FLAG_UTF8_NAMES = 0x0800;

const FILES = [
  'manifest.json',
  // A PNG is already compressed, so deflating it makes it slightly larger.
  // Every length in the archive has to be the compressed one, not the source.
  'icons/icon16.png',
  '_locales/en/messages.json'
];

/**
 * The archive writer is the one part of the release that nothing else exercises
 * and no browser can catch: the store simply refuses an upload it cannot read.
 * So the bytes are read back here the way a reader reads them, and the two
 * things a reader checks - the checksums and the offsets - are checked against
 * something other than the code that wrote them.
 */
module.exports = {
  name: 'the archive the store is given',
  browser: false,

  run(t) {
    const sources = FILES.map((name) => ({ name, data: fs.readFileSync(path.join(ROOT, name)) }));
    const date = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));
    const archive = zip.create(sources.map((file) => ({ name: file.name, data: file.data, date })));

    const found = read(archive);

    t.expect('every file is in it, in the order it was given',
      found.entries.map((entry) => entry.name), FILES);
    t.expect('the end record counts what the directory holds',
      [found.total, found.entries.length], [FILES.length, FILES.length]);
    t.expect('the directory ends exactly where the end record begins',
      [found.directoryEndsAt, found.directoryOffset + found.directorySize],
      [found.endsAt, found.endsAt]);

    t.expect('each entry inflates back to the file it came from',
      found.entries.map((entry, i) => entry.data.equals(sources[i].data)),
      FILES.map(() => true));
    t.expect('and the length recorded for it is the length of that file',
      found.entries.map((entry) => entry.size), sources.map((file) => file.data.length));

    // Node's own checksum, so the one in the archive is not compared against
    // the implementation that put it there.
    const nodeCrc = typeof zlib.crc32 === 'function' ? zlib.crc32 : null;
    t.expect('node can check the checksums independently', !!nodeCrc, true);
    if (nodeCrc) {
      t.expect('every checksum agrees with one computed elsewhere',
        found.entries.map((entry, i) => entry.crc === nodeCrc(sources[i].data)),
        FILES.map(() => true));
    }

    t.expect('the names are flagged as UTF-8, which is how they are written',
      found.entries.map((entry) => (entry.flags & FLAG_UTF8_NAMES) !== 0),
      FILES.map(() => true));

    // The flag above is a promise about names that no file in this package
    // puts to the test, so one is made up here.
    const awkward = zip.create([{ name: 'src/\u00e9t\u00e9/\u65e5\u672c.txt', data: Buffer.from('hello'), date }]);
    t.expect('a name outside ASCII survives the round trip',
      read(awkward).entries[0].name, 'src/\u00e9t\u00e9/\u65e5\u672c.txt');

    // The build promises the same source always produces the same bytes, which
    // is what makes one upload comparable with the next.
    const again = zip.create(sources.map((file) => ({ name: file.name, data: file.data, date })));
    t.expect('the same files produce the same archive twice', again.equals(archive), true);
  }
};
