/**
 * Behavior tests for the storage layer against a temp DB seeded from the Task 1
 * fixtures. Deterministic: temp dirs per test, no real ~/.claude, no network.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LensIndex } from '../src/storage/db.ts';
import { indexProjects } from '../src/storage/index-sessions.ts';
import { listSessions, listByProject } from '../src/storage/queries.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'fixtures');

/** Build a temp projects dir with the given fixtures under one project subdir, plus a temp DB path. */
function setup(fixtures: string[]): { projectsDir: string; dbPath: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'cclens-'));
  const projectsDir = join(root, 'projects');
  const proj = join(projectsDir, '-tmp-project');
  mkdirSync(proj, { recursive: true });
  for (const f of fixtures) copyFileSync(join(fixturesDir, f), join(proj, f));
  return { projectsDir, dbPath: join(root, 'index.db'), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('S1 — open → migrate → persist → reopen keeps data', async () => {
  const { projectsDir, dbPath, cleanup } = setup(['multiblock.jsonl']);
  try {
    const idx = await LensIndex.open(dbPath);
    indexProjects(idx, projectsDir);
    idx.persist();
    idx.close();
    const reopened = await LensIndex.open(dbPath);
    assert.equal(listSessions(reopened).length, 1);
    reopened.close();
  } finally {
    cleanup();
  }
});

test('S2 — index writes sessions + turns matching parser output', async () => {
  const { projectsDir, dbPath, cleanup } = setup(['multiblock.jsonl']);
  try {
    const idx = await LensIndex.open(dbPath);
    const res = indexProjects(idx, projectsDir);
    assert.equal(res.indexed, 1);
    const [s] = listSessions(idx);
    assert.equal(s?.turn_count, 6);
    assert.equal(s?.record_count, 4);
    assert.deepEqual(s?.tokens, { input: 300, output: 80, cache_creation: 10, cache_read: 25 });
    idx.close();
  } finally {
    cleanup();
  }
});

test('S3 — listByProject groups under project_path', async () => {
  const { projectsDir, dbPath, cleanup } = setup(['multiblock.jsonl', 'branch.jsonl']);
  try {
    const idx = await LensIndex.open(dbPath);
    indexProjects(idx, projectsDir);
    const groups = listByProject(idx);
    // both fixtures set their own cwd/gitBranch; multiblock has cwd, branch has none → its
    // project_path falls back to the decoded temp dir. Either way every session lands in a group.
    const total = groups.reduce((n, g) => n + g.sessions.length, 0);
    assert.equal(total, 2);
    idx.close();
  } finally {
    cleanup();
  }
});

test('S4/S5/S6 — sorts by date, duration, messages', async () => {
  const { projectsDir, dbPath, cleanup } = setup(['multiblock.jsonl', 'branch.jsonl']);
  try {
    const idx = await LensIndex.open(dbPath);
    indexProjects(idx, projectsDir);
    // multiblock: 2026-08-10, 4s span, 6 turns ; branch: 2026-08-11, 3s span, 4 turns
    const byDateDesc = listSessions(idx, { sortBy: 'date', order: 'desc' });
    assert.equal(byDateDesc[0]?.id, 'sess-br-1'); // Aug 11 newest
    const byDur = listSessions(idx, { sortBy: 'duration', order: 'desc' });
    assert.equal(byDur[0]?.id, 'sess-mb-1'); // 4s > 3s
    const byMsg = listSessions(idx, { sortBy: 'messages', order: 'desc' });
    assert.equal(byMsg[0]?.id, 'sess-mb-1'); // 6 > 4
    idx.close();
  } finally {
    cleanup();
  }
});

test('S7 — re-index with no changes skips every file', async () => {
  const { projectsDir, dbPath, cleanup } = setup(['multiblock.jsonl', 'branch.jsonl']);
  try {
    const idx = await LensIndex.open(dbPath);
    indexProjects(idx, projectsDir);
    idx.persist();
    idx.close();
    const idx2 = await LensIndex.open(dbPath);
    const res = indexProjects(idx2, projectsDir);
    assert.equal(res.indexed, 0);
    assert.equal(res.skipped, 2);
    idx2.close();
  } finally {
    cleanup();
  }
});

test('S8 — a changed file is re-indexed without duplicating rows', async () => {
  const { projectsDir, dbPath, cleanup } = setup(['multiblock.jsonl']);
  try {
    const idx = await LensIndex.open(dbPath);
    indexProjects(idx, projectsDir);
    const before = listSessions(idx)[0];
    idx.persist();
    idx.close();

    // Append another assistant record to the same session (changes size + mtime).
    const target = join(projectsDir, '-tmp-project', 'multiblock.jsonl');
    appendFileSync(
      target,
      '\n{"type":"assistant","sessionId":"sess-mb-1","uuid":"a3","parentUuid":"a2","timestamp":"2026-08-10T09:00:06.000Z","message":{"role":"assistant","model":"m","content":[{"type":"text","text":"more"}],"usage":{"input_tokens":1,"output_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}\n',
    );

    const idx2 = await LensIndex.open(dbPath);
    const res = indexProjects(idx2, projectsDir);
    assert.equal(res.indexed, 1);
    assert.equal(res.skipped, 0);
    const after = listSessions(idx2);
    assert.equal(after.length, 1); // still ONE session, not two
    assert.ok((after[0]?.turn_count ?? 0) > (before?.turn_count ?? 0)); // grew, not duplicated
    idx2.close();
  } finally {
    cleanup();
  }
});

test('S9 — a removed source file has its rows pruned', async () => {
  const { projectsDir, dbPath, cleanup } = setup(['multiblock.jsonl', 'branch.jsonl']);
  try {
    const idx = await LensIndex.open(dbPath);
    indexProjects(idx, projectsDir);
    idx.persist();
    idx.close();

    rmSync(join(projectsDir, '-tmp-project', 'branch.jsonl'));
    const idx2 = await LensIndex.open(dbPath);
    const res = indexProjects(idx2, projectsDir);
    assert.equal(res.removed, 1);
    const ids = listSessions(idx2).map((s) => s.id);
    assert.ok(!ids.includes('sess-br-1'));
    assert.ok(ids.includes('sess-mb-1'));
    idx2.close();
  } finally {
    cleanup();
  }
});

test('S11 — indexing does not modify source files', async () => {
  const { projectsDir, dbPath, cleanup } = setup(['multiblock.jsonl']);
  try {
    const target = join(projectsDir, '-tmp-project', 'multiblock.jsonl');
    const before = readFileSync(target);
    const idx = await LensIndex.open(dbPath);
    indexProjects(idx, projectsDir);
    idx.persist();
    idx.close();
    assert.deepEqual(readFileSync(target), before);
  } finally {
    cleanup();
  }
});

test('S13 — a session sharded across two files aggregates into ONE session', async () => {
  const { projectsDir, dbPath, cleanup } = setup([]);
  try {
    // Two files, SAME sessionId, DISJOINT records (mirrors real Claude Code sharding).
    const dir = join(projectsDir, '-tmp-project');
    writeFileSync(
      join(dir, 'shard-a.jsonl'),
      [
        '{"type":"user","sessionId":"shared","uuid":"s1","parentUuid":null,"timestamp":"2026-08-09T08:00:00.000Z","gitBranch":"main","cwd":"/proj","message":{"role":"user","content":"one"}}',
        '{"type":"assistant","sessionId":"shared","uuid":"s2","parentUuid":"s1","timestamp":"2026-08-09T08:00:01.000Z","message":{"role":"assistant","model":"m","content":[{"type":"text","text":"a"}],"usage":{"input_tokens":10,"output_tokens":5,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}',
      ].join('\n'),
    );
    writeFileSync(
      join(dir, 'shard-b.jsonl'),
      [
        '{"type":"user","sessionId":"shared","uuid":"s3","parentUuid":"s2","timestamp":"2026-08-09T09:00:00.000Z","message":{"role":"user","content":"two"}}',
        '{"type":"assistant","sessionId":"shared","uuid":"s4","parentUuid":"s3","timestamp":"2026-08-09T09:00:02.000Z","message":{"role":"assistant","model":"m","content":[{"type":"text","text":"b"}],"usage":{"input_tokens":20,"output_tokens":7,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}',
      ].join('\n'),
    );
    const idx = await LensIndex.open(dbPath);
    const res = indexProjects(idx, projectsDir);
    assert.equal(res.indexed, 2); // two files indexed
    const sessions = listSessions(idx);
    assert.equal(sessions.length, 1); // ONE session, not two
    const s = sessions[0]!;
    assert.equal(s.id, 'shared');
    assert.equal(s.turn_count, 4); // 2 + 2 across both shards
    assert.equal(s.record_count, 4);
    assert.deepEqual(s.tokens, { input: 30, output: 12, cache_creation: 0, cache_read: 0 }); // summed
    assert.equal(s.started_at, '2026-08-09T08:00:00.000Z'); // MIN across shards
    assert.equal(s.ended_at, '2026-08-09T09:00:02.000Z'); // MAX across shards

    // Removing ONE shard shrinks the session but does not delete it.
    rmSync(join(dir, 'shard-b.jsonl'));
    const idx2 = await LensIndex.open(dbPath);
    indexProjects(idx2, projectsDir);
    const after = listSessions(idx2);
    assert.equal(after.length, 1);
    assert.equal(after[0]?.turn_count, 2); // only shard-a remains
    idx2.close();
    idx.close();
  } finally {
    cleanup();
  }
});

test('S12 — duplicated record uuid / shared session id does not throw', async () => {
  const { projectsDir, dbPath, cleanup } = setup([]);
  try {
    // Two records with the SAME uuid, plus a normal one — must merge, not throw.
    const dup = [
      '{"type":"user","sessionId":"dup","uuid":"d1","parentUuid":null,"timestamp":"2026-08-13T00:00:00.000Z","message":{"role":"user","content":"a"}}',
      '{"type":"user","sessionId":"dup","uuid":"d1","parentUuid":null,"timestamp":"2026-08-13T00:00:01.000Z","message":{"role":"user","content":"b"}}',
    ].join('\n');
    writeFileSync(join(projectsDir, '-tmp-project', 'dup.jsonl'), dup);
    const idx = await LensIndex.open(dbPath);
    assert.doesNotThrow(() => indexProjects(idx, projectsDir));
    assert.equal(listSessions(idx).length, 1);
    idx.close();
  } finally {
    cleanup();
  }
});
