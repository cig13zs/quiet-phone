// Serves dist/ at /quiet-phone/, the way GitHub Pages will, on a free local port.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.gif': 'image/gif' };

export async function serve() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error('dist/ is missing; run npm run build first');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/quiet-phone/')) {
      res.writeHead(302, { location: '/quiet-phone/' });
      return res.end();
    }
    let file = path.join(DIST, decodeURIComponent(url.pathname.slice('/quiet-phone/'.length)) || 'index.html');
    if (!file.startsWith(DIST)) {
      res.writeHead(403);
      return res.end();
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}/quiet-phone/`, close: () => new Promise((r) => server.close(r)) };
}
