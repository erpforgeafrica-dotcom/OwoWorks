#!/usr/bin/env node
/**
 * serve — static file server for apps/web/ on http://localhost:8080.
 *
 * Local preview only. It binds to 127.0.0.1 explicitly: a preview server that
 * binds 0.0.0.0 exposes the pilot site to the local network.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, dirname, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WWW = join(ROOT, 'apps', 'web');
const PORT = Number(process.env.PORT || 8080);
const HOST = '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel.endsWith('/')) rel += 'index.html';

    // Path traversal guard: resolve, then verify the result is still inside WWW.
    const target = normalize(join(WWW, rel));
    if (target !== WWW && !target.startsWith(WWW + sep)) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      return res.end('403 Forbidden');
    }

    const info = await stat(target).catch(() => null);
    if (!info || !info.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end(`404 Not Found: ${rel}`);
    }

    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': TYPES[extname(target).toLowerCase()] || 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('500 Internal Server Error');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Amplo pilot preview: http://${HOST}:${PORT}`);
  console.log('Bound to loopback only. Ctrl+C to stop.');
});
