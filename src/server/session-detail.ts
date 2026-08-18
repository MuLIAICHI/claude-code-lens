/**
 * Session detail assembly: turns one session's stored turn rows into the wire
 * order the UI renders — record tree order (parents before children, siblings
 * by timestamp) with each record's blocks in block-index order. Reads only
 * through the storage query layer; reuses the parser's pure tree ordering.
 */

import type { LensIndex } from '../storage/db.ts';
import { getSession, getSessionTurns } from '../storage/queries.ts';
import type { SessionDetail, TurnRow } from '../storage/types.ts';
import { orderByParent } from '../parser/tree.ts';

/** A record (tree node) reassembled from its sibling turn rows. */
interface RecordGroup {
  uuid: string;
  parentUuid: string | null;
  /** Earliest timestamp among the record's turns — drives sibling order. */
  timestamp: string;
  turns: TurnRow[];
}

/** Numeric block index from a turn id (`${record_uuid}:${blockIndex}`). */
function blockIndex(turnId: string): number {
  const i = turnId.lastIndexOf(':');
  const n = i >= 0 ? Number(turnId.slice(i + 1)) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/** Group turn rows (already timestamp-ordered) into records, keeping first-seen order. */
function groupRecords(rows: TurnRow[]): RecordGroup[] {
  const byUuid = new Map<string, RecordGroup>();
  for (const row of rows) {
    const existing = byUuid.get(row.record_uuid);
    if (existing) {
      existing.turns.push(row);
    } else {
      byUuid.set(row.record_uuid, {
        uuid: row.record_uuid,
        parentUuid: row.parent_id,
        timestamp: row.timestamp,
        turns: [row],
      });
    }
  }
  return [...byUuid.values()];
}

/**
 * Build the full detail payload for one session: metadata plus every turn in
 * display order. Returns null when the session id is unknown.
 */
export function getSessionDetail(index: LensIndex, id: string): SessionDetail | null {
  const session = getSession(index, id);
  if (session === null) return null;

  const rows = getSessionTurns(index, id);
  const ordered = orderByParent(groupRecords(rows));

  const turns: TurnRow[] = [];
  for (const record of ordered) {
    record.turns.sort((a, b) => blockIndex(a.id) - blockIndex(b.id));
    turns.push(...record.turns);
  }
  return { session, turns };
}
