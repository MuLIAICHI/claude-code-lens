/**
 * External-behavior tests for the parser, against committed fixtures.
 * Deterministic: no real ~/.claude reads, no network, no clock/random.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseSession, parseLine, type FileMeta } from '../src/parser/parse.ts';
import { orderByParent } from '../src/parser/tree.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string[] =>
  readFileSync(join(here, '..', 'fixtures', name), 'utf8').split('\n');

const META: FileMeta = { fallbackId: 'fallback', fallbackProject: '/fallback' };

test('T1 — multiblock: correct session, record and turn counts', () => {
  const { session, turns } = parseSession(fixture('multiblock.jsonl'), META);
  assert.ok(session);
  assert.equal(session.record_count, 4); // u1, a1, u2, a2
  assert.equal(session.turn_count, 6); // 1 + 3 + 1 + 1
  assert.equal(turns.length, 6);
  assert.equal(session.id, 'sess-mb-1');
  assert.equal(session.title, 'Fix the ordrix parser');
  assert.equal(session.git_branch, 'main');
});

test('T2 — multiblock record yields 3 Turns with shared parent and correct types/ids', () => {
  const { turns } = parseSession(fixture('multiblock.jsonl'), META);
  const a1 = turns.filter((t) => t.record_uuid === 'a1');
  assert.deepEqual(
    a1.map((t) => t.type),
    ['thinking', 'text', 'tool_use'],
  );
  assert.deepEqual(
    a1.map((t) => t.id),
    ['a1:0', 'a1:1', 'a1:2'],
  );
  assert.ok(a1.every((t) => t.parent_id === 'u1'));
});

test('T3 — user string content → single text Turn', () => {
  const { turns } = parseSession(fixture('multiblock.jsonl'), META);
  const u1 = turns.filter((t) => t.record_uuid === 'u1');
  assert.equal(u1.length, 1);
  assert.equal(u1[0]?.type, 'text');
  assert.equal(u1[0]?.content, 'parse this file please');
});

test('T4 — user array tool_result content → tool_result Turn', () => {
  const { turns } = parseSession(fixture('multiblock.jsonl'), META);
  const u2 = turns.filter((t) => t.record_uuid === 'u2');
  assert.equal(u2.length, 1);
  assert.equal(u2[0]?.type, 'tool_result');
  assert.match(u2[0]?.content ?? '', /export const a = 1/);
});

test('T5 — orderByParent places parents before children, handles a branch', () => {
  const ordered = orderByParent([
    { uuid: 'b-u2b', parentUuid: 'b-a1' },
    { uuid: 'b-a1', parentUuid: 'b-u1' },
    { uuid: 'b-u1', parentUuid: null },
    { uuid: 'b-u2', parentUuid: 'b-a1' },
  ]);
  const idx = (u: string): number => ordered.findIndex((n) => n.uuid === u);
  assert.ok(idx('b-u1') < idx('b-a1'));
  assert.ok(idx('b-a1') < idx('b-u2'));
  assert.ok(idx('b-a1') < idx('b-u2b'));
  assert.equal(ordered.length, 4);
});

test('T6 — malformed line is skipped and counted, valid records still parse', () => {
  const { session, skipped } = parseSession(fixture('malformed.jsonl'), META);
  assert.ok(session);
  assert.equal(skipped.malformed, 1);
  assert.equal(session.record_count, 3);
  assert.equal(session.turn_count, 3);
});

test('T7 — non-conversation types (ai-title, mode) counted, not turned', () => {
  const { skipped } = parseSession(fixture('multiblock.jsonl'), META);
  assert.equal(skipped.nonConversation, 2); // ai-title + mode
  assert.equal(skipped.unknownType, 0);
});

test('T8 — token usage is split by kind (not one misleading sum)', () => {
  const { session } = parseSession(fixture('multiblock.jsonl'), META);
  // a1: in100/out50/cw10/cr5 ; a2: in200/out30/cw0/cr20
  assert.deepEqual(session?.tokens, {
    input: 300,
    output: 80,
    cache_creation: 10,
    cache_read: 25,
  });
});

test('T9 — tool_use Turn captures tool_name', () => {
  const { turns } = parseSession(fixture('multiblock.jsonl'), META);
  const toolUse = turns.find((t) => t.type === 'tool_use');
  assert.equal(toolUse?.tool_name, 'Read');
});

test('parseLine returns null on malformed and empty input', () => {
  assert.equal(parseLine('{ not json'), null);
  assert.equal(parseLine('   '), null);
  assert.equal(parseLine('[1,2,3]'), null); // arrays are not records
  assert.ok(parseLine('{"type":"user"}'));
});
