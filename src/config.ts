/**
 * Sessions-path resolution. The only knob a user needs for `scan`.
 *
 * Precedence: explicit path arg > `CLAUDE_CONFIG_DIR` env > default `~/.claude`.
 * The sessions live under `<configDir>/projects`. Fails loud if the resolved
 * projects directory does not exist.
 */

import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { existsSync, statSync } from 'node:fs';

/** Expand a leading `~` to the user's home directory. */
export function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

export interface ResolveOptions {
  /** Explicit sessions/projects path from a `--path` flag (highest precedence). */
  pathArg?: string | undefined;
  /** Environment map (injected for testability; defaults to process.env). */
  env?: NodeJS.ProcessEnv;
}

/**
 * Resolve the absolute path to the Claude Code projects directory.
 * Throws with an actionable message if it does not exist.
 */
export function resolveProjectsDir(opts: ResolveOptions = {}): string {
  const env = opts.env ?? process.env;

  let projectsDir: string;
  if (opts.pathArg && opts.pathArg.trim() !== '') {
    projectsDir = expandHome(opts.pathArg.trim());
  } else if (env.CLAUDE_CONFIG_DIR && env.CLAUDE_CONFIG_DIR.trim() !== '') {
    projectsDir = join(expandHome(env.CLAUDE_CONFIG_DIR.trim()), 'projects');
  } else {
    projectsDir = join(homedir(), '.claude', 'projects');
  }

  if (!isAbsolute(projectsDir)) projectsDir = join(process.cwd(), projectsDir);

  if (!existsSync(projectsDir) || !statSync(projectsDir).isDirectory()) {
    throw new Error(
      `Claude Code projects directory not found at: ${projectsDir}\n` +
        `Pass --path <dir>, set CLAUDE_CONFIG_DIR, or confirm Claude Code has written sessions.`,
    );
  }
  return projectsDir;
}
