/**
 * Redaction tests (R1–R4). The detector is pure and unit-tested directly; R4
 * proves the server never redacts (masking is display-layer only). All planted
 * values are OBVIOUSLY FAKE (FAKE/0000 filler in valid shapes).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectSecrets } from '../src/redact/detect.ts';
import { LensIndex } from '../src/storage/db.ts';
import { indexProjects } from '../src/storage/index-sessions.ts';
import { startServer } from '../src/server/server.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'fixtures');

test('R1 — every planted secret kind is detected with the right span', () => {
  const cases: Array<{ text: string; kind: string; masked: string }> = [
    { text: 'key sk-ant-FAKE0000000000000000000000 here', kind: 'api-key', masked: 'sk-ant-FAKE0000000000000000000000' },
    { text: 'tok ghp_FAKE00000000000000000000000000000000 x', kind: 'api-key', masked: 'ghp_FAKE00000000000000000000000000000000' },
    { text: 'pat github_pat_FAKE000000000000000000 y', kind: 'api-key', masked: 'github_pat_FAKE000000000000000000' },
    { text: 'slack xoxb-FAKE-000000000000 z', kind: 'api-key', masked: 'xoxb-FAKE-000000000000' },
    { text: 'aws AKIAFAKE000000000000 q', kind: 'api-key', masked: 'AKIAFAKE000000000000' },
    { text: 'g AIzaFAKE0000000000000000000000000000000 w', kind: 'api-key', masked: 'AIzaFAKE0000000000000000000000000000000' },
    { text: 'jwt eyJFAKE00000.eyJFAKE11111.FAKE0 end', kind: 'jwt', masked: 'eyJFAKE00000.eyJFAKE11111.FAKE0' },
    {
      text: 'pem -----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY----- done',
      kind: 'private-key',
      masked: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----',
    },
    { text: 'Authorization: Bearer FAKEFAKEFAKEFAKEFAKE1234', kind: 'api-key', masked: 'FAKEFAKEFAKEFAKEFAKE1234' },
    { text: 'DATABASE_PASSWORD=fakepass123', kind: 'env-value', masked: 'fakepass123' },
    { text: 'export MY_AUTH_TOKEN="fake-token-value"', kind: 'env-value', masked: 'fake-token-value' },
    { text: 'db at postgres://admin:fakepw123@localhost:5432/db', kind: 'password', masked: 'fakepw123' },
  ];
  for (const c of cases) {
    const spans = detectSecrets(c.text);
    assert.equal(spans.length, 1, `expected exactly one span for: ${c.text}`);
    const s = spans[0];
    assert.ok(s, 'span present');
    assert.equal(s.kind, c.kind, `kind for: ${c.text}`);
    assert.equal(c.text.slice(s.start, s.end), c.masked, `masked substring for: ${c.text}`);
  }
});

test('R2 — no false positives on ordinary content', () => {
  const clean = [
    'session 8bcf42fc-2e71-4102-aad5-1fd1061b7a2d finished',
    'commit aea7456c7befef461eeda6f45df8c549d950456f on main',
    'The quick brown fox jumps over the lazy dog, then reads the docs.',
    'NODE_ENV=production',
    'LOG_LEVEL=debug',
    'const total = records.length + 1;',
    'ended_at TEXT NOT NULL, tok_input INTEGER NOT NULL DEFAULT 0',
    'a skeleton of the task — risk-first, user-first',
  ];
  for (const text of clean) {
    assert.deepEqual(detectSecrets(text), [], `false positive in: ${text}`);
  }
});

test('R3 — overlapping matches merge into sorted non-overlapping spans', () => {
  // The env value IS an sk- key: both rules match the same region.
  const text = 'MY_SECRET_KEY=sk-FAKE0000000000000000000000 and xoxb-FAKE-000000000000';
  const spans = detectSecrets(text);
  assert.equal(spans.length, 2);
  for (let i = 1; i < spans.length; i++) {
    const prev = spans[i - 1];
    const cur = spans[i];
    assert.ok(prev && cur && prev.end <= cur.start, 'spans sorted and non-overlapping');
  }
  const first = spans[0];
  assert.ok(first);
  assert.equal(text.slice(first.start, first.end), 'sk-FAKE0000000000000000000000');
});

test('R4 — server never redacts: planted values arrive verbatim (display-layer only)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cclens-redact-'));
  const projectsDir = join(root, 'projects', '-tmp-demo');
  mkdirSync(projectsDir, { recursive: true });
  copyFileSync(join(fixturesDir, 'secrets.jsonl'), join(projectsDir, 'secrets.jsonl'));
  const index = await LensIndex.open(join(root, 'index.db'));
  indexProjects(index, join(root, 'projects'));
  const srv = await startServer(index, root);
  try {
    const res = await fetch(`${srv.url}/api/sessions/sess-sec-1`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.ok(body.includes('sk-ant-FAKE0000000000000000000000'), 'API key present verbatim');
    assert.ok(body.includes('fakepass123'), 'env value present verbatim');
    assert.ok(body.includes('ghp_FAKE00000000000000000000000000000000'), 'GitHub token present verbatim');
  } finally {
    await srv.close();
    index.close();
    rmSync(root, { recursive: true, force: true });
  }
});
