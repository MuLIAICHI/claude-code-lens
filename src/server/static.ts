/**
 * Static file server for the built web assets, with a path-traversal guard.
 * Every request is resolved and confined to the dist root; anything escaping it
 * (e.g. `/../../etc/passwd`) is refused. This tool is trusted with secrets, so
 * the guard is non-negotiable even though the server is localhost-only.
 */

import type { ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, sep, extname } from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

function notFound(res: ServerResponse): void {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

/**
 * Serve a file from `distRoot` for the given URL path. `/` maps to `index.html`.
 * Refuses (404) anything that resolves outside `distRoot` or is not a regular file.
 */
export function serveStatic(distRoot: string, urlPath: string, res: ServerResponse): void {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  // Resolve against the root, then confirm the result stays inside it.
  const target = resolve(distRoot, '.' + rel);
  if (target !== distRoot && !target.startsWith(distRoot + sep)) {
    notFound(res);
    return;
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    notFound(res);
    return;
  }
  const type = CONTENT_TYPES[extname(target)] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  res.end(readFileSync(target));
}
