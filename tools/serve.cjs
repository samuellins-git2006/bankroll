// Servidor de desenvolvimento — arquivo estático simples, sem dependências.
// Uso: npm run dev  →  http://localhost:3000/client/
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let filePath;

  if (urlPath.startsWith('/shared/')) {
    // módulos compartilhados (engine/config) ficam na raiz do projeto
    filePath = path.normalize(path.join(ROOT, urlPath));
  } else {
    // todo o resto vem da pasta client (raiz do site)
    const clean = urlPath === '/' ? '/index.html' : urlPath;
    filePath = path.normalize(path.join(ROOT, 'client', clean));
  }

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('Proibido');
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) filePath = path.join(filePath, 'index.html');
    fs.readFile(filePath, (err2, data) => {
      if (err2) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('404 — não encontrado: ' + urlPath);
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    });
  });
});

server.listen(PORT, () => {
  console.log(`✅ Bankroll rodando em: http://localhost:${PORT}/`);
});
