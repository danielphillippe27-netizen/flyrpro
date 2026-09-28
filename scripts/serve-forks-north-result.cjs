const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local'), quiet: true });
const root = '/Users/danielphillippe/.codex/visualizations/2026/09/19/01a0bad9-26ae-7102-b1c0-ed8cf2006ee6/forks-north';
http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/config') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ token: process.env.NEXT_PUBLIC_MAPBOX_TOKEN }));
    return;
  }
  const file = pathname === '/' ? 'index.html' : pathname === '/results.json' ? 'results.json' : null;
  if (!file) { response.writeHead(404); response.end(); return; }
  response.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : 'application/json');
  response.end(fs.readFileSync(path.join(root, file)));
}).listen(8770, '127.0.0.1', () => console.log('Forks North result: http://127.0.0.1:8770'));
