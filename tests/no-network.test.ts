/**
 * The zero-network guarantee (N2) + disk-unchanged proof (N3). Wraps the
 * socket layer so ANY outbound connection attempt to a non-loopback host is
 * recorded, runs a full scan (index) + render surface (list, detail, static
 * page) over loopback, then asserts the outbound log is empty and the raw
 * session files are byte-identical. node:test runs this file in its own
 * process, so patching globals cannot leak into other test files.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import net from 'node:net';

import { LensIndex } from '../src/storage/db.ts';
import { indexProjects } from '../src/storage/index-sessions.ts';
import { startServer } from '../src/server/server.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'fixtures');

/** Hosts that stay on this machine. undefined = Node's default (localhost). */
function isLoopback(host: unknown): boolean {
  if (host === undefined || host === null) return true;
  const h = String(host);
  return h === 'localhost' || h === '::1' || h.startsWith('127.') || h.startsWith('::ffff:127.');
}

/** sha256 of every file in a directory (recursive), keyed by relative path. */
function hashDir(dir: string, base = dir): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) Object.assign(out, hashDir(p, base));
    else out[p.slice(base.length + 1)] = createHash('sha256').update(readFileSync(p)).digest('hex');
  }
  return out;
}

test('N2+N3 — scan + render make zero outbound calls and never touch source files', async () => {
  const outbound: string[] = [];

  // Guard 1: socket layer — covers http/https/undici(fetch), everything TCP.
  const realConnect = net.Socket.prototype.connect;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (net.Socket.prototype as any).connect = function (this: net.Socket, ...args: unknown[]) {
    const first = args[0];
    let host: unknown;
    if (typeof first === 'object' && first !== null) host = (first as { host?: unknown }).host;
    else if (typeof first === 'number') host = typeof args[1] === 'string' ? args[1] : undefined;
    // string first arg = unix socket path — local by definition.
    if (!isLoopback(host)) outbound.push(`socket:${String(host)}`);
    return (realConnect as unknown as (...a: unknown[]) => net.Socket).apply(this, args);
  };

  // Guard 2: fetch URL layer — catches the intent even before DNS/socket.
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    try {
      if (!isLoopback(new URL(url).hostname)) outbound.push(`fetch:${url}`);
    } catch {
      // relative URL — same-origin/local, fine
    }
    return realFetch(input, init);
  }) as typeof fetch;

  const root = mkdtempSync(join(tmpdir(), 'cclens-nonet-'));
  try {
    // Real session-file layout: these copies ARE the scanned "raw source files".
    const projectsDir = join(root, 'projects', '-tmp-project');
    mkdirSync(projectsDir, { recursive: true });
    for (const f of ['multiblock.jsonl', 'branch.jsonl', 'secrets.jsonl', 'malformed.jsonl']) {
      copyFileSync(join(fixturesDir, f), join(projectsDir, f));
    }
    const dist = join(root, 'dist');
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>NONET</title>');

    const before = hashDir(projectsDir);

    // Scan + render surface.
    const index = await LensIndex.open(join(root, 'index.db'));
    indexProjects(index, join(root, 'projects'));
    index.persist();
    const srv = await startServer(index, dist);
    try {
      const list = await fetch(`${srv.url}/api/sessions?group=1`);
      assert.equal(list.status, 200);
      const detail = await fetch(`${srv.url}/api/sessions/sess-sec-1`);
      assert.equal(detail.status, 200);
      const page = await fetch(`${srv.url}/`);
      assert.equal(page.status, 200);
    } finally {
      await srv.close();
      index.close();
    }

    // N2: nothing attempted to leave the machine.
    assert.deepEqual(outbound, [], `outbound network attempts detected: ${outbound.join(', ')}`);

    // N3: raw session files are byte-identical after scan + render.
    assert.deepEqual(hashDir(projectsDir), before, 'source session files were modified');
  } finally {
    net.Socket.prototype.connect = realConnect;
    globalThis.fetch = realFetch;
    rmSync(root, { recursive: true, force: true });
  }
});

test('N2-negative — the guard actually detects a non-loopback attempt', async () => {
  // Sanity check that the guard is not vacuous: a fetch aimed at a public host
  // must be recorded. The request itself is aborted before any packet leaves.
  const outbound: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!isLoopback(new URL(url).hostname)) outbound.push(url);
    return Promise.reject(new Error('blocked by test guard'));
  }) as typeof fetch;
  try {
    await assert.rejects(fetch('https://example.com/should-be-caught'));
    assert.equal(outbound.length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});
