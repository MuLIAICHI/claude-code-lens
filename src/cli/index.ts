#!/usr/bin/env node
/**
 * `cc-lens` CLI entry. v1 (M1) ships one subcommand: `scan`.
 * Usage:
 *   cc-lens scan [--path <projects-dir>]
 */

import { resolveProjectsDir } from '../config.ts';
import { runScan, formatStats } from './scan.ts';
import { runIndexCommand } from './index-cmd.ts';

/** Extract `--path <value>` from argv, if present. */
function readPathFlag(argv: string[]): string | undefined {
  const i = argv.indexOf('--path');
  if (i !== -1 && i + 1 < argv.length) return argv[i + 1];
  return undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(
      'cc-lens — Lens for Claude Code\n\nUsage:\n' +
        '  cc-lens scan  [--path <projects-dir>]   print session stats to the terminal\n' +
        '  cc-lens index [--path <projects-dir>]   build/update the local index (~/.claude-code-lens/index.db)\n',
    );
    return;
  }

  if (command === 'scan') {
    const pathArg = readPathFlag(argv);
    try {
      const projectsDir = resolveProjectsDir({ pathArg });
      const stats = runScan({ pathArg });
      process.stdout.write(formatStats(stats, projectsDir) + '\n');
    } catch (err) {
      process.stderr.write(`cc-lens scan failed: ${(err as Error).message}\n`);
      process.exitCode = 1;
    }
    return;
  }

  if (command === 'index') {
    try {
      await runIndexCommand(readPathFlag(argv));
    } catch (err) {
      process.stderr.write(`cc-lens index failed: ${(err as Error).message}\n`);
      process.exitCode = 1;
    }
    return;
  }

  process.stderr.write(`Unknown command: ${command}\nRun \`cc-lens help\`.\n`);
  process.exitCode = 1;
}

void main();
