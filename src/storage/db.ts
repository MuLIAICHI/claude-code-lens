/**
 * sql.js index lifecycle: open (load or create), migrate, atomic persist, close.
 *
 * sql.js keeps the whole database in memory, so persistence means exporting the
 * full byte image and atomically replacing the file. The DB lives at
 * `~/.claude-code-lens/index.db`; source session files are never written here.
 */

import initSqlJs, { type Database } from 'sql.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';

/** Default directory for the Lens index — never inside the Claude Code source files. */
export function defaultDbDir(): string {
  return join(homedir(), '.claude-code-lens');
}

/** Default index file path. */
export function defaultDbPath(): string {
  return join(defaultDbDir(), 'index.db');
}

const MIGRATIONS = `
-- One row per source .jsonl file. Stores the file's PARTIAL aggregate; a session
-- (one sessionId, possibly sharded across many files) is recomputed by summing
-- its files' rows. mtime_ms + size drive incremental skipping.
CREATE TABLE IF NOT EXISTS files (
  path           TEXT PRIMARY KEY,
  mtime_ms       INTEGER NOT NULL,
  size           INTEGER NOT NULL,
  session_id     TEXT,
  turn_count     INTEGER NOT NULL DEFAULT 0,
  record_count   INTEGER NOT NULL DEFAULT 0,
  tok_input        INTEGER NOT NULL DEFAULT 0,
  tok_output       INTEGER NOT NULL DEFAULT 0,
  tok_cache_write  INTEGER NOT NULL DEFAULT 0,
  tok_cache_read   INTEGER NOT NULL DEFAULT 0,
  started_at     TEXT,
  ended_at       TEXT,
  title          TEXT,
  project_path   TEXT,
  git_branch     TEXT,
  indexed_at     TEXT NOT NULL
);
-- One row per sessionId. All columns are COMPUTED aggregates over the session's files.
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  project_path  TEXT NOT NULL,
  started_at    TEXT NOT NULL,
  ended_at      TEXT NOT NULL,
  turn_count    INTEGER NOT NULL,
  record_count  INTEGER NOT NULL,
  tok_input        INTEGER NOT NULL,
  tok_output       INTEGER NOT NULL,
  tok_cache_write  INTEGER NOT NULL,
  tok_cache_read   INTEGER NOT NULL,
  git_branch    TEXT,
  title         TEXT,
  file_count    INTEGER NOT NULL
);
-- One row per content block. source_file lets a changed shard replace only its own turns.
CREATE TABLE IF NOT EXISTS turns (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  source_file  TEXT NOT NULL,
  record_uuid  TEXT NOT NULL,
  parent_id    TEXT,
  role         TEXT NOT NULL,
  type         TEXT NOT NULL,
  content      TEXT NOT NULL,
  tool_name    TEXT,
  timestamp    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id);
CREATE INDEX IF NOT EXISTS idx_turns_file ON turns(source_file);
CREATE INDEX IF NOT EXISTS idx_files_session ON files(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path);
`;

/**
 * A thin wrapper over a sql.js {@link Database} bound to a file path.
 * Holds the DB in memory; call {@link LensIndex.persist} to flush to disk.
 */
export class LensIndex {
  private constructor(
    /** The underlying sql.js database (in memory). */
    public readonly db: Database,
    /** Absolute path this index persists to. */
    public readonly path: string,
  ) {}

  /** Open the index at `dbPath` (loading existing bytes if present), run migrations. */
  static async open(dbPath: string = defaultDbPath()): Promise<LensIndex> {
    const SQL = await initSqlJs();
    const db = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database();
    db.run(MIGRATIONS);
    return new LensIndex(db, dbPath);
  }

  /**
   * Atomically write the in-memory DB to disk: export bytes to a temp file in
   * the SAME directory (so rename cannot cross filesystems), then rename over
   * the target.
   */
  persist(): void {
    const dir = join(this.path, '..');
    mkdirSync(dir, { recursive: true });
    const bytes = this.db.export();
    const tmp = join(dir, `.index.db.tmp-${process.pid}`);
    writeFileSync(tmp, Buffer.from(bytes));
    renameSync(tmp, this.path);
  }

  /** Release the in-memory database. Does not persist — call {@link persist} first. */
  close(): void {
    this.db.close();
  }
}
