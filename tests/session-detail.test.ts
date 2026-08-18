/**
 * Detail API external-behavior tests (D1–D4) against fixture sessions, plus
 * pure diff-logic unit tests (D5–D6). Deterministic: temp dirs, no network
 * beyond the local test server.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LensIndex } from '../src/storage/db.ts';
import { indexProjects } from '../src/storage/index-sessions.ts';
import { startServer } from '../src/server/server.ts';
import type { SessionDetail } from '../src/storage/types.ts';
import { diffLines, extractEdits } from '../web/src/diff.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'fixtures');

/** Temp index seeded from both conversation fixtures, behind a real server. */
async function setup(): Promise<{ url: string; teardown: () => Promise<void> }> {
  const root = mkdtempSync(join(tmpdir(), 'cclens-detail-'));
  const projectsDir = join(root, 'projects', '-tmp-project');
  mkdirSync(projectsDir, { recursive: true });
  for (const f of ['multiblock.jsonl', 'branch.jsonl']) copyFileSync(join(fixturesDir, f), join(projectsDir, f));
  const index = await LensIndex.open(join(root, 'index.db'));
  indexProjects(index, join(root, 'projects'));
  const srv = await startServer(index, root); // dist root unused by API routes
  return {
    url: srv.url,
    teardown: async () => {
      await srv.close();
      index.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('D1 — detail returns turns in tree order with correct types', async () => {
  const { url, teardown } = await setup();
  try {
    const res = await fetch(`${url}/api/sessions/sess-mb-1`);
    assert.equal(res.status, 200);
    const data = (await res.json()) as SessionDetail;
    assert.deepEqual(
      data.turns.map((t) => t.id),
      ['u1:0', 'a1:0', 'a1:1', 'a1:2', 'u2:0', 'a2:0'],
    );
    assert.deepEqual(
      data.turns.map((t) => t.type),
      ['text', 'thinking', 'text', 'tool_use', 'tool_result', 'text'],
    );
    const toolUse = data.turns[3];
    assert.equal(toolUse?.tool_name, 'Read');
    assert.equal(data.turns[0]?.role, 'user');
    assert.equal(data.turns[1]?.role, 'assistant');
  } finally {
    await teardown();
  }
});

test('D2 — detail includes session meta with split tokens (never a sum)', async () => {
  const { url, teardown } = await setup();
  try {
    const res = await fetch(`${url}/api/sessions/sess-mb-1`);
    const data = (await res.json()) as SessionDetail;
    assert.equal(data.session.id, 'sess-mb-1');
    assert.equal(data.session.title, 'Fix the ordrix parser');
    assert.deepEqual(data.session.tokens, { input: 300, output: 80, cache_creation: 10, cache_read: 25 });
  } finally {
    await teardown();
  }
});

test('D3 — branched siblings: parents first, input order kept', async () => {
  const { url, teardown } = await setup();
  try {
    const res = await fetch(`${url}/api/sessions/sess-br-1`);
    const data = (await res.json()) as SessionDetail;
    assert.deepEqual(
      data.turns.map((t) => t.record_uuid),
      ['b-u1', 'b-a1', 'b-u2', 'b-u2b'],
    );
  } finally {
    await teardown();
  }
});

test('D4 — unknown session id → 404 JSON', async () => {
  const { url, teardown } = await setup();
  try {
    const res = await fetch(`${url}/api/sessions/no-such-session`);
    assert.equal(res.status, 404);
    const data = (await res.json()) as { error: string };
    assert.match(data.error, /unknown session/);
  } finally {
    await teardown();
  }
});

test('D5 — diffLines: ctx/del/add in document order', () => {
  assert.deepEqual(diffLines('a\nb\nc', 'a\nx\nc'), [
    { kind: 'ctx', text: 'a' },
    { kind: 'del', text: 'b' },
    { kind: 'add', text: 'x' },
    { kind: 'ctx', text: 'c' },
  ]);
  // Identical → all ctx; empty old → all add; empty new → all del.
  assert.deepEqual(diffLines('same', 'same'), [{ kind: 'ctx', text: 'same' }]);
  assert.deepEqual(diffLines('', 'n1\nn2'), [
    { kind: 'add', text: 'n1' },
    { kind: 'add', text: 'n2' },
  ]);
  assert.deepEqual(diffLines('o1', ''), [{ kind: 'del', text: 'o1' }]);
});

test('D6 — extractEdits maps Edit/Write/MultiEdit, rejects the rest', () => {
  const edit = extractEdits('Edit', JSON.stringify({ file_path: '/a.ts', old_string: 'x', new_string: 'y' }));
  assert.deepEqual(edit, [{ file_path: '/a.ts', old_string: 'x', new_string: 'y' }]);

  const write = extractEdits('Write', JSON.stringify({ file_path: '/b.ts', content: 'body' }));
  assert.deepEqual(write, [{ file_path: '/b.ts', old_string: '', new_string: 'body' }]);

  const multi = extractEdits(
    'MultiEdit',
    JSON.stringify({ file_path: '/c.ts', edits: [{ old_string: '1', new_string: '2' }, { old_string: '3', new_string: '4' }] }),
  );
  assert.equal(multi?.length, 2);
  assert.equal(multi?.[1]?.new_string, '4');

  assert.equal(extractEdits('Read', JSON.stringify({ file_path: '/d.ts' })), null);
  assert.equal(extractEdits(null, '{}'), null);
  assert.equal(extractEdits('Edit', 'not json'), null);
});
