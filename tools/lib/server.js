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

/**
 * A page holding a frame served from a different host name, which is what an
 * embedded video, map or advert is. The same server answers to both names, so
 * the frame is genuinely cross origin without a second server.
 */
function embeddedPage(host) {
  const parts = String(host || '').split(':');
  const other = (parts[0] === 'localhost' ? '127.0.0.1' : 'localhost') + (parts[1] ? ':' + parts[1] : '');
  return [
    '<!doctype html><html><head><meta charset="utf-8"><title>an embedded frame</title>',
    '</head><body>',
    '<img id="own-image" src="/checker.png" width="120" height="120">',
    '<iframe id="embedded" src="http://' + other + '/frame-inner.html" width="300" height="160"></iframe>',
    '</body></html>'
  ].join('');
}

function start() {
  const server = http.createServer(handle);

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();

      // The cross origin checks reach these same pages through "localhost",
      // which resolves to ::1 before 127.0.0.1 on plenty of machines. Rather
      // than lean on the browser falling back from a refused connection, the
      // same handler answers on both loopback addresses. Where there is no
      // IPv6 the second one refuses to start, which is not a failure: it only
      // means localhost can mean 127.0.0.1 and nothing else there.
      const sameOnIpv6 = http.createServer(handle);
      const started = () => resolve({
        port,
        origin: 'http://127.0.0.1:' + port,
        stop: () => Promise.all([
          new Promise((done) => server.close(() => done())),
          new Promise((done) => sameOnIpv6.close(() => done()))
        ])
      });

      // Either way round, but not before one of them: a check that fetched
      // through localhost while this was still binding would be the flake
      // this is here to prevent.
      sameOnIpv6.on('error', () => {});
      sameOnIpv6.once('error', started);
      sameOnIpv6.once('listening', started);
      sameOnIpv6.listen(port, '::1');
    });
  });
}

function handle(request, response) {
  const name = decodeURIComponent((request.url || '/').split('?')[0]).replace(/^\//, '') || 'index.html';

  if (name === 'generated/embedded.html') {
    response.writeHead(200, { 'Content-Type': TYPES['.html'] });
    response.end(embeddedPage(request.headers.host));
    return;
  }

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
}

module.exports = { start };
