/**
 * JSON API handlers. Reads exclusively through the Task 2 query layer — never
 * re-parses raw files. Same-origin, localhost only; no auth, no CORS.
 */

import type { ServerResponse } from 'node:http';
import type { LensIndex } from '../storage/db.ts';
import { listSessions, listByProject } from '../storage/queries.ts';
import { getSessionDetail } from './session-detail.ts';
import type { SortBy, SortOrder } from '../storage/types.ts';

const SORT_KEYS: readonly SortBy[] = ['date', 'duration', 'messages'];
const ORDERS: readonly SortOrder[] = ['asc', 'desc'];

/** Parse + validate sort params, falling back to defaults (never throws / 500s). */
function parseListOptions(url: URL): { sortBy: SortBy; order: SortOrder; grouped: boolean } {
  const rawSort = url.searchParams.get('sortBy');
  const rawOrder = url.searchParams.get('order');
  const sortBy = SORT_KEYS.includes(rawSort as SortBy) ? (rawSort as SortBy) : 'date';
  const order = ORDERS.includes(rawOrder as SortOrder) ? (rawOrder as SortOrder) : 'desc';
  const grouped = url.searchParams.get('group') !== '0';
  return { sortBy, order, grouped };
}

/** Write a JSON response. */
function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

/**
 * Handle an `/api/*` request. Returns true if it matched an API route (handled),
 * false otherwise (caller falls through to static serving).
 */
export function handleApi(index: LensIndex, url: URL, res: ServerResponse): boolean {
  if (!url.pathname.startsWith('/api/')) return false;

  if (url.pathname === '/api/sessions') {
    const { sortBy, order, grouped } = parseListOptions(url);
    if (grouped) json(res, 200, { groups: listByProject(index, { sortBy, order }) });
    else json(res, 200, { sessions: listSessions(index, { sortBy, order }) });
    return true;
  }

  const detailMatch = /^\/api\/sessions\/([^/]+)$/.exec(url.pathname);
  if (detailMatch?.[1] !== undefined) {
    let id: string;
    try {
      id = decodeURIComponent(detailMatch[1]);
    } catch {
      json(res, 404, { error: `unknown session: ${detailMatch[1]}` });
      return true;
    }
    const detail = getSessionDetail(index, id);
    if (detail === null) json(res, 404, { error: `unknown session: ${id}` });
    else json(res, 200, detail);
    return true;
  }

  json(res, 404, { error: `unknown api route: ${url.pathname}` });
  return true;
}
