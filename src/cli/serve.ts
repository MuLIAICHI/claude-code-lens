/**
 * Default `cc-lens` command: refresh the index, boot the localhost server, open
 * the browser to the session list. Runs until interrupted (Ctrl-C).
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

import { resolveProjectsDir } from '../config.ts';
import { LensIndex } from '../storage/db.ts';
import { indexProjects } from '../storage/index-sessions.ts';
import { startServer } from '../server/server.ts';
import { openBrowser } from '../server/open-browser.ts';

/** Locate the built web assets — `<repo>/web/dist`, reachable from both src/ and dist/ layouts. */
export function webDistDir(): string {
  const here = dirname(fileURLToPath(import.meta.url)); // src/cli or dist/cli
  return resolve(here, '..', '..', 'web', 'dist');
}

/** Boot the dashboard: index-on-boot, serve, open browser. */
export async function runServeCommand(pathArg?: string): Promise<void> {
  const projectsDir = resolveProjectsDir({ pathArg });
  const dist = webDistDir();
  if (!existsSync(dist)) {
    throw new Error(`web assets not built. Run \`npm run build\` first (expected ${dist}).`);
  }

  const index = await LensIndex.open();
  const res = indexProjects(index, projectsDir);
  index.persist();

  const server = await startServer(index, dist);
  process.stdout.write(
    `Lens for Claude Code → ${server.url}\n` +
      `  indexed ${res.indexed}, skipped ${res.skipped}, removed ${res.removed}. Press Ctrl-C to stop.\n`,
  );
  openBrowser(server.url);

  // Graceful shutdown on Ctrl-C.
  process.on('SIGINT', () => {
    void server.close().then(() => {
      index.close();
      process.exit(0);
    });
  });
}
