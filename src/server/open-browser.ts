/**
 * Open a URL in the default browser, cross-platform, with no dependency.
 * Best-effort: failure is swallowed (the URL is also printed to stdout).
 */

import { spawn } from 'node:child_process';

/** Open `url` in the user's default browser (macOS / Windows / Linux). */
export function openBrowser(url: string): void {
  let cmd: string;
  let args: string[];
  if (process.platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (process.platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    // Non-fatal: the URL is printed for the user to open manually.
  }
}
