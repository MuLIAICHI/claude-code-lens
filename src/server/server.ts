/**
 * The tiny local HTTP server. Binds 127.0.0.1 ONLY (never 0.0.0.0): Lens renders
 * transcripts that can contain secrets, so the dashboard must not be reachable
 * from the LAN. Routes `/api/*` to the JSON API, everything else to static files.
 */

import { createServer, type Server } from 'node:http';
import type { LensIndex } from '../storage/db.ts';
import { handleApi } from './api.ts';
import { serveStatic } from './static.ts';

/** Localhost-only bind address. Do not change to 0.0.0.0 — see file header. */
export const HOST = '127.0.0.1';

/** A running Lens server handle. */
export interface RunningServer {
  port: number;
  url: string;
  /** The bind address — always {@link HOST}. Exposed so tests can assert localhost-only. */
  host: string;
  close: () => Promise<void>;
}

/**
 * Start the server on an OS-assigned free port, bound to localhost only.
 * `distRoot` is the built web asset directory to serve static files from.
 */
export function startServer(index: LensIndex, distRoot: string): Promise<RunningServer> {
  const server: Server = createServer((req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${HOST}`);
      if (handleApi(index, url, res)) return;
      serveStatic(distRoot, url.pathname, res);
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal error');
    }
  });

  return new Promise<RunningServer>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      resolvePromise({
        port,
        host: HOST,
        url: `http://${HOST}:${port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}
