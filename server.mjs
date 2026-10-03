#!/usr/bin/env node
/**
 * Promota production web server.
 *
 * Serves the static site in apps/web and injects window.OWOWORKS at runtime
 * from environment variables (SUPABASE_URL, SUPABASE_ANON_KEY). Nothing is
 * baked into the image, so the same build works in every environment and no
 * backend key is ever committed. The key it serves is the publishable key,
 * which is public by design: database grants and row-level security are the
 * enforcement, and the only public write path is the submit_lead function.
 *
 * If the variables are absent the config is empty and the site reports that it
 * is not connected - it never pretends to have sent anything.
 *
 * Binds 0.0.0.0 so the container is reachable behind Railway's edge proxy.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, dirname, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const WWW = join(ROOT, 'apps', 'web');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_ANON_KEY = (process.env.SUPABASE_ANON_KEY || '').trim();
const CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

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

const CACHEABLE = new Set(['.png', '.webp', '.svg', '.ico']);

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://*.supabase.co",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy': CSP,
  'permissions-policy': 'geolocation=(), camera=(), microphone=()',
};

function runtimeConfigBody() {
  const cfg = { SUPABASE_URL, SUPABASE_ANON_KEY };
  return '/* Injected at runtime by server.mjs. Publishable key only. */\n'
    + 'window.OWOWORKS = ' + JSON.stringify(cfg) + ';\n';
}

function send(res, status, headers, body, headOnly) {
  res.writeHead(status, headers);
  return headOnly ? res.end() : res.end(body);
}

const server = createServer(async (req, res) => {
  const headOnly = req.method === 'HEAD';
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' }, '405 Method Not Allowed', headOnly);
    }

    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname);

    if (rel === '/config.js') {
      const body = Buffer.from(runtimeConfigBody(), 'utf8');
      return send(res, 200, { ...SECURITY_HEADERS, 'content-type': 'text/javascript; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store' }, body, headOnly);
    }

    if (rel === '/healthz') {
      const body = Buffer.from(JSON.stringify({ ok: true, config: CONFIGURED }), 'utf8');
      return send(res, 200, { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store' }, body, headOnly);
    }

    if (rel === '/' || rel.endsWith('/')) rel += 'index.html';

    const target = normalize(join(WWW, rel));
    if (target !== WWW && !target.startsWith(WWW + sep)) {
      return send(res, 403, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' }, '403 Forbidden', headOnly);
    }

    const info = await stat(target).catch(() => null);
    if (!info || !info.isFile()) {
      return send(res, 404, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' }, '404 Not Found', headOnly);
    }

    const ext = extname(target).toLowerCase();
    const body = await readFile(target);
    return send(res, 200, {
      ...SECURITY_HEADERS,
      'content-type': TYPES[ext] || 'application/octet-stream',
      'content-length': body.length,
      'cache-control': CACHEABLE.has(ext) ? 'public, max-age=86400' : 'no-cache',
    }, body, headOnly);
  } catch (err) {
    return send(res, 500, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' }, '500 Internal Server Error', headOnly);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`owoworks web listening on http://${HOST}:${PORT} (supabase configured: ${CONFIGURED})`);
});
