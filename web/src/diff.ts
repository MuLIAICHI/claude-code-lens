/**
 * Pure diff logic for the detail view — no DOM, no I/O, so it is unit-testable
 * from node. Line-based LCS diff plus extraction of file edits from Claude Code
 * tool_use inputs (Edit / MultiEdit / Write).
 */

/** One line of a rendered diff. */
export interface DiffOp {
  kind: 'ctx' | 'add' | 'del';
  text: string;
}

/** A single file edit extracted from a tool_use input. */
export interface FileEdit {
  file_path: string;
  old_string: string;
  new_string: string;
}

/** Past this many lines per side, fall back to plain del/add blocks (no LCS). */
const MAX_LCS_LINES = 2000;

/** Split into lines; the empty string is zero lines (not one empty line). */
function toLines(s: string): string[] {
  return s === '' ? [] : s.split('\n');
}

/**
 * Line-based diff of two strings. Unchanged lines come out as `ctx`, removals
 * as `del`, insertions as `add`, in document order. Inputs larger than
 * {@link MAX_LCS_LINES} lines per side skip LCS and return del-block + add-block.
 */
export function diffLines(oldStr: string, newStr: string): DiffOp[] {
  const a = toLines(oldStr);
  const b = toLines(newStr);

  if (a.length > MAX_LCS_LINES || b.length > MAX_LCS_LINES) {
    return [
      ...a.map((text): DiffOp => ({ kind: 'del', text })),
      ...b.map((text): DiffOp => ({ kind: 'add', text })),
    ];
  }

  // LCS length table: lcs[i][j] = LCS of a[i..] and b[j..].
  const rows = a.length + 1;
  const cols = b.length + 1;
  const lcs: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    const cur = lcs[i] as number[];
    const next = lcs[i + 1] as number[];
    for (let j = b.length - 1; j >= 0; j--) {
      cur[j] = a[i] === b[j] ? (next[j + 1] as number) + 1 : Math.max(next[j] as number, cur[j + 1] as number);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'ctx', text: a[i] as string });
      i++;
      j++;
    } else if (((lcs[i + 1] as number[])[j] as number) >= ((lcs[i] as number[])[j + 1] as number)) {
      ops.push({ kind: 'del', text: a[i] as string });
      i++;
    } else {
      ops.push({ kind: 'add', text: b[j] as string });
      j++;
    }
  }
  while (i < a.length) ops.push({ kind: 'del', text: a[i++] as string });
  while (j < b.length) ops.push({ kind: 'add', text: b[j++] as string });
  return ops;
}

/** Read a string field from an unknown object, defaulting to ''. */
function str(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === 'string' ? v : '';
}

/**
 * Extract file edits from a tool_use turn's content (the JSON-stringified tool
 * input). Returns null when the tool is not a file-editing tool or the content
 * does not parse — callers then render the payload as plain JSON.
 */
export function extractEdits(toolName: string | null, content: string): FileEdit[] | null {
  if (toolName !== 'Edit' && toolName !== 'MultiEdit' && toolName !== 'Write') return null;
  let input: unknown;
  try {
    input = JSON.parse(content);
  } catch {
    return null;
  }
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  const obj = input as Record<string, unknown>;
  const file_path = str(obj, 'file_path');

  if (toolName === 'Edit') {
    return [{ file_path, old_string: str(obj, 'old_string'), new_string: str(obj, 'new_string') }];
  }
  if (toolName === 'Write') {
    return [{ file_path, old_string: '', new_string: str(obj, 'content') }];
  }
  // MultiEdit: an `edits` array of {old_string, new_string} against one file.
  const edits = obj.edits;
  if (!Array.isArray(edits)) return null;
  const out: FileEdit[] = [];
  for (const e of edits) {
    if (e === null || typeof e !== 'object') continue;
    const eo = e as Record<string, unknown>;
    out.push({ file_path, old_string: str(eo, 'old_string'), new_string: str(eo, 'new_string') });
  }
  return out.length > 0 ? out : null;
}
