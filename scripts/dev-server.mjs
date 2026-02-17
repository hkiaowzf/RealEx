import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { cwd } from 'node:process';

const DEFAULT_PORT = Number(process.env.PORT || 5173);
const ROOT = cwd();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

function safePath(urlPath) {
  const raw = decodeURIComponent(urlPath.split('?')[0] || '/');
  const normalized = normalize(raw).replace(/^(\.\.[/\\])+/, '');
  const rel = normalized.startsWith('/') ? normalized.slice(1) : normalized;
  return join(ROOT, rel || 'index.html');
}

const server = createServer(async (req, res) => {
  try {
    const requestPath = req.url || '/';
    let filePath = safePath(requestPath);

    if (requestPath === '/' || extname(filePath) === '') {
      filePath = join(ROOT, 'index.html');
    }

    const body = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
});

function start(port) {
  server.listen(port, '0.0.0.0', () => {
    console.log(`ExpoGrid dev server running at:`);
    console.log(`- http://127.0.0.1:${port}`);
    console.log(`- http://localhost:${port}`);
  });
}

server.on('error', (err) => {
  if ((err.code === 'EADDRINUSE' || err.code === 'EACCES' || err.code === 'EPERM') && !process.env.PORT) {
    const next = (server.address()?.port || DEFAULT_PORT) + 1;
    if (next <= DEFAULT_PORT + 20) {
      console.warn(`Port unavailable, retrying on ${next}...`);
      setTimeout(() => start(next), 20);
      return;
    }
  }
  console.error(`Failed to start dev server: ${err.code || err.message}`);
  process.exit(1);
});

start(DEFAULT_PORT);
