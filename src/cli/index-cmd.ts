/**
 * `cc-lens index` — build/update the local SQLite index from the session files.
 * Reads source files, writes only to `~/.claude-code-lens/index.db`.
 */

import { resolveProjectsDir } from '../config.ts';
import { LensIndex, defaultDbPath } from '../storage/db.ts';
import { indexProjects } from '../storage/index-sessions.ts';

/** Run indexing against the resolved projects dir and print the result. */
export async function runIndexCommand(pathArg?: string): Promise<void> {
  const projectsDir = resolveProjectsDir({ pathArg });
  const index = await LensIndex.open();
  try {
    const res = indexProjects(index, projectsDir);
    index.persist();
    const out = [
      `Lens for Claude Code — indexed ${projectsDir}`,
      '',
      `  Indexed (new/changed): ${res.indexed}`,
      `  Skipped (unchanged):   ${res.skipped}`,
      `  Removed (deleted):     ${res.removed}`,
      '',
      `  Index: ${defaultDbPath()}`,
    ].join('\n');
    process.stdout.write(out + '\n');
  } finally {
    index.close();
  }
}
