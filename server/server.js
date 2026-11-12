/*
 * server.js — conteneur web d'OpenTTD Portfolio.
 * Sert le client (HTML/JS/WASM/données) sous le préfixe /openttd/ avec les bons types
 * MIME (application/wasm…), la compression gzip pré-calculée et des en-têtes de cache
 * adaptés à Cloudflare : ressources versionnées (?v=<build>) en cache long et immuable,
 * index.html et le reste revalidés à chaque visite.
 *
 * Variables d'environnement : PORT (8080), PREFIX (/openttd), PUBLIC_DIR (./public)
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '8080', 10);
const PREFIX = (process.env.PREFIX || '/openttd').replace(/\/+$/, '');
const PUBLIC_DIR = path.resolve(process.env.PUBLIC_DIR || path.join(__dirname, 'public'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
  '.cat': 'application/octet-stream',
  '.obs': 'text/plain; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

function log(...args) { console.log(new Date().toISOString(), ...args); }

function serveStatic(req, res, rel) {
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('404'); }
    const headers = {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': /[?&]v=/.test(req.url) ? 'public, max-age=31536000, immutable' : 'no-cache',
      // taille réelle (non compressée) : sert à la barre de progression
      'X-Raw-Length': st.size,
      'Vary': 'Accept-Encoding',
    };
    let target = file, size = st.size;
    const gz = file + '.gz';
    if (/\bgzip\b/.test(req.headers['accept-encoding'] || '') && fs.existsSync(gz)) {
      target = gz; size = fs.statSync(gz).size; headers['Content-Encoding'] = 'gzip';
    }
    headers['Content-Length'] = size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(target).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let p;
  try { p = decodeURIComponent(url.pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  if (p === PREFIX + '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ ok: true }));
  }
  if (p === '/' || p === PREFIX) { res.writeHead(301, { Location: PREFIX + '/' + url.search }); return res.end(); }
  if (!p.startsWith(PREFIX + '/')) { res.writeHead(404); return res.end('404'); }
  serveStatic(req, res, p.slice(PREFIX.length + 1));
});

server.listen(PORT, () => log(`openttd-portfolio : http://0.0.0.0:${PORT}${PREFIX}/`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { log('arrêt'); process.exit(0); });
