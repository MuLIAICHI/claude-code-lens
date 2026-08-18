/**
 * Record-tree reconstruction. Pure — no I/O.
 *
 * Claude Code threads records with `uuid` / `parentUuid`. Ordering by file line
 * is usually right, but edits/branches produce siblings under one parent, so we
 * reorder explicitly: every parent appears before its children, siblings keep
 * their original relative order.
 */

/** Minimal shape needed to place a record in the tree. */
export interface TreeNode {
  uuid: string;
  parentUuid: string | null;
}

/**
 * Return `records` in tree order: parents before children, siblings in input
 * order. Roots are records whose `parentUuid` is null or points outside the set
 * (orphans are treated as roots so nothing is dropped).
 */
export function orderByParent<T extends TreeNode>(records: T[]): T[] {
  const childrenOf = new Map<string, T[]>();
  const present = new Set(records.map((r) => r.uuid));

  const roots: T[] = [];
  for (const r of records) {
    const parent = r.parentUuid;
    if (parent === null || !present.has(parent)) {
      roots.push(r);
    } else {
      const bucket = childrenOf.get(parent);
      if (bucket) bucket.push(r);
      else childrenOf.set(parent, [r]);
    }
  }

  const ordered: T[] = [];
  const seen = new Set<string>();
  const visit = (node: T): void => {
    if (seen.has(node.uuid)) return; // guard against cycles
    seen.add(node.uuid);
    ordered.push(node);
    for (const child of childrenOf.get(node.uuid) ?? []) visit(child);
  };
  for (const root of roots) visit(root);

  // Any record not reached (e.g. inside a cycle) is appended in input order.
  for (const r of records) {
    if (!seen.has(r.uuid)) {
      seen.add(r.uuid);
      ordered.push(r);
    }
  }
  return ordered;
}
