/**
 * Server + static behavior tests. API tests run a real localhost server against a
 * temp index; the traversal guard is unit-tested directly (fetch normalizes `..`
 * away, so it can't exercise the guard through the network). Deterministic.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LensIndex } from '../src/storage/db.ts';
import { indexProjects } from '../src/storage/index-sessions.ts';
import { startServer } from '../src/server/server.ts';
import { serveStatic } from '../src/server/static.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'fixtures');

/** Temp index seeded from fixtures + a temp dist dir with a marker index.html. */
async function setup(): Promise<{ index: LensIndex; dist: string; cleanup: () => void }> {
  const root = mkdtempSync(join(tmpdir(), 'cclens-srv-'));
  const projectsDir = join(root, 'projects', '-tmp-project');
  mkdirSync(projectsDir, { recursive: true });
  for (const f of ['multiblock.jsonl', 'branch.jsonl']) copyFileSync(join(fixturesDir, f), join(projectsDir, f));
  const dist = join(root, 'dist');
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>LENS-TEST</title>');
  const index = await LensIndex.open(join(root, 'index.db'));
  indexProjects(index, join(root, 'projects'));
  return { index, dist, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** Minimal ServerResponse stand-in capturing status + body for unit tests. */
function fakeRes(): { status: number; body: string; writeHead: (s: number, h?: unknown) => unknown; end: (b?: unknown) => unknown } {
  const r = {
    status: 0,
    body: '',
    writeHead(s: number) {
      r.status = s;
      return r;
    },
    end(b?: unknown) {
      if (b !== undefined) r.body = String(b);
      return r;
    },
  };
  return r;
}

test('A1 — GET /api/sessions?group=1 returns groups', async () => {
  const { index, dist, cleanup } = await setup();
  const srv = await startServer(index, dist);
  try {
    const res = await fetch(`${srv.url}/api/sessions?group=1`);
    assert.equal(res.status, 200);
    const data = (await res.json()) as { groups: unknown[] };
    assert.ok(Array.isArray(data.groups));
    assert.ok(data.groups.length >= 1);
  } finally {
    await srv.close();
    index.close();
    cleanup();
  }
});

test('A2 — sort params pass through', async () => {
  const { index, dist, cleanup } = await setup();
  const srv = await startServer(index, dist);
  try {
    const res = await fetch(`${srv.url}/api/sessions?group=0&sortBy=messages&order=desc`);
    const data = (await res.json()) as { sessions: { turn_count: number }[] };
    const counts = data.sessions.map((s) => s.turn_count);
    const sorted = [...counts].sort((a, b) => b - a);
    assert.deepEqual(counts, sorted);
  } finally {
    await srv.close();
    index.close();
    cleanup();
  }
});

test('A3 — bad sort params fall back to defaults (200, not 500)', async () => {
  const { index, dist, cleanup } = await setup();
  const srv = await startServer(index, dist);
  try {
    const res = await fetch(`${srv.url}/api/sessions?sortBy=bogus&order=sideways`);
    assert.equal(res.status, 200);
    const data = (await res.json()) as { groups: unknown[] };
    assert.ok(Array.isArray(data.groups));
  } finally {
    await srv.close();
    index.close();
    cleanup();
  }
});

test('A4 — unknown /api route → 404 JSON', async () => {
  const { index, dist, cleanup } = await setup();
  const srv = await startServer(index, dist);
  try {
    const res = await fetch(`${srv.url}/api/nope`);
    assert.equal(res.status, 404);
    const data = (await res.json()) as { error: string };
    assert.match(data.error, /unknown api route/);
  } finally {
    await srv.close();
    index.close();
    cleanup();
  }
});

test('A5 — GET / serves index.html', async () => {
  const { index, dist, cleanup } = await setup();
  const srv = await startServer(index, dist);
  try {
    const res = await fetch(`${srv.url}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await res.text(), /LENS-TEST/);
  } finally {
    await srv.close();
    index.close();
    cleanup();
  }
});

test('A6 — path traversal is refused (404), stays inside dist', () => {
  const root = mkdtempSync(join(tmpdir(), 'cclens-guard-'));
  writeFileSync(join(root, 'index.html'), 'ok');
  try {
    for (const attack of ['/../../../etc/passwd', '/../package.json']) {
      const res = fakeRes();
      serveStatic(root, attack, res as never);
      assert.equal(res.status, 404, `expected 404 for ${attack}`);
    }
    // Sanity: a legitimate file inside the root IS served.
    const ok = fakeRes();
    serveStatic(root, '/index.html', ok as never);
    assert.equal(ok.status, 200);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('A7 — server binds 127.0.0.1 (never 0.0.0.0)', async () => {
  const { index, dist, cleanup } = await setup();
  const srv = await startServer(index, dist);
  try {
    assert.equal(srv.host, '127.0.0.1');
    assert.match(srv.url, /^http:\/\/127\.0\.0\.1:/);
  } finally {
    await srv.close();
    index.close();
    cleanup();
  }
});

test('N1 — built web/dist has zero external http(s) references', () => {
  const distDir = join(here, '..', 'web', 'dist');
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
    );
  const files = walk(distDir);
  assert.ok(files.length > 0, 'web/dist should be built before this test (npm run build)');
  const offenders: string[] = [];
  for (const f of files) {
    if (!/\.(html|js|css|mjs)$/.test(f)) continue;
    const text = readFileSync(f, 'utf8');
    const m = text.match(/https?:\/\/[a-zA-Z]/);
    if (m) offenders.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(offenders, [], `external references found: ${offenders.join(', ')}`);
});
