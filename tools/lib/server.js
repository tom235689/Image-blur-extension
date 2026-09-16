'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PAGES = path.join(__dirname, '..', 'pages');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

/**
 * A page with more elements than any single scanning chunk can handle, built
 * here rather than committed, with the interesting targets at the very end so
 * that anything which quietly stops scanning early is caught.
 */
function largeDomPage(rows) {
  const filler = new Array(rows).fill('<div class="filler">row</div>').join('');
  return [
    '<!doctype html><html><head><meta charset="utf-8"><title>large dom</title>',
    '<style>.filler{height:2px}.tile{height:80px;background-image:url("checker.png");background-size:cover}</style>',
    '</head><body>',
    '<div class="tile" id="first-tile"></div>',
    filler,
    '<div class="tile" id="last-tile"></div>',
    '<img id="last-image" src="checker.png" width="60" height="60">',
    '</body></html>'
  ].join('');
}

function start() {
  const server = http.createServer((request, response) => {
    const name = decodeURIComponent((request.url || '/').split('?')[0]).replace(/^\//, '') || 'index.html';

    if (name === 'generated/large-dom.html') {
      response.writeHead(200, { 'Content-Type': TYPES['.html'] });
      response.end(largeDomPage(8000));
      return;
    }

    const file = path.join(PAGES, name);
    if (!file.startsWith(PAGES)) {
      response.writeHead(403);
      response.end('forbidden');
      return;
    }

    fs.readFile(file, (error, body) => {
      if (error) {
        response.writeHead(404);
        response.end('not found');
        return;
      }
      response.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      response.end(body);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        origin: 'http://127.0.0.1:' + port,
        stop: () => new Promise((done) => server.close(done))
      });
    });
  });
}

module.exports = { start };
