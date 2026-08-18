/**
 * Pure secret-pattern detector for the display-layer redaction (task 5).
 * Curated shapes only — no entropy heuristics, so UUIDs / git SHAs / ordinary
 * prose never false-positive. Returns sorted, merged spans over the input;
 * never mutates or throws. No I/O and no DOM: compiled for the node build and
 * bundled into the web frontend alike.
 *
 * NOTE for bundled code: keep this file free of literal web URLs — the built
 * frontend is scanned for external references (zero-network guarantee).
 */

/** Category of a detected secret. */
export type SecretKind = 'api-key' | 'jwt' | 'private-key' | 'env-value' | 'password';

/** One masked region of the input: [start, end) character offsets. */
export interface Span {
  start: number;
  end: number;
  kind: SecretKind;
  /** Human chip label, e.g. "API key". */
  label: string;
}

/**
 * A detection rule. When `prefixGroup` is true the regex has exactly two capture
 * groups — (prefix)(secret) — and only the secret group is masked; otherwise the
 * whole match is masked.
 */
interface Rule {
  re: RegExp;
  kind: SecretKind;
  label: string;
  prefixGroup?: boolean;
}

/**
 * Env keys that suggest a secret value. PASS covers PASSWORD/PASSWD/DB_PASS;
 * plain NODE_ENV / LOG_LEVEL style vars never match.
 */
const SECRET_ENV_KEY = '[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASS[A-Z0-9_]*|CREDENTIALS?|AUTH|DSN)[A-Z0-9_]*';

const RULES: readonly Rule[] = [
  // Vendor-prefixed API keys (Anthropic/OpenAI sk-, GitHub, Slack, AWS, Google).
  { re: /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}/g, kind: 'api-key', label: 'API key' },
  { re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, kind: 'api-key', label: 'GitHub token' },
  { re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g, kind: 'api-key', label: 'GitHub token' },
  { re: /\bxox[baposr]-[A-Za-z0-9-]{10,}/g, kind: 'api-key', label: 'Slack token' },
  { re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, kind: 'api-key', label: 'AWS key id' },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/g, kind: 'api-key', label: 'Google API key' },
  // JWTs: three base64url segments, first one starting {"... (eyJ).
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{5,}\b/g, kind: 'jwt', label: 'JWT' },
  // PEM private-key blocks (full block preferred; a stray BEGIN header alone
  // still flags via overlap-merge if the block regex also matched).
  {
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    kind: 'private-key',
    label: 'private key',
  },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, kind: 'private-key', label: 'private key' },
  // Bearer tokens: mask the token, keep the word "Bearer" visible.
  { re: /(\bBearer\s+)([A-Za-z0-9._~+/=-]{20,})/g, kind: 'api-key', label: 'bearer token', prefixGroup: true },
  // Secret-named env pairs: mask the VALUE only — the key name stays visible so
  // the user sees which variable leaked.
  {
    re: new RegExp(`(^\\s*(?:export\\s+)?${SECRET_ENV_KEY}\\s*=\\s*["']?)([^\\s"']{8,})`, 'gm'),
    kind: 'env-value',
    label: 'env value',
    prefixGroup: true,
  },
  // Credentials in connection URLs: mask the password between `user:` and `@`.
  { re: /([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)([^\s@/]{3,})(?=@)/g, kind: 'password', label: 'password', prefixGroup: true },
];

/** Merge overlapping spans (input sorted by start), keeping the earliest label. */
function mergeSpans(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s.start < last.end) {
      if (s.end > last.end) last.end = s.end;
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

/**
 * Detect secret-shaped substrings in `text`. Returns sorted, merged,
 * non-overlapping spans; empty array for clean input. Pure and total — any
 * unexpected regex state is dropped rather than thrown.
 */
export function detectSecrets(text: string): Span[] {
  if (text === '') return [];
  const spans: Span[] = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text)) !== null) {
      if (m[0].length === 0) {
        rule.re.lastIndex += 1; // safety: never loop on a zero-length match
        continue;
      }
      let start = m.index;
      let end = m.index + m[0].length;
      if (rule.prefixGroup) {
        const prefix = m[1] ?? '';
        const secret = m[2] ?? '';
        start = m.index + prefix.length;
        end = start + secret.length;
        if (secret.length === 0) continue;
      }
      spans.push({ start, end, kind: rule.kind, label: rule.label });
    }
  }
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  return mergeSpans(spans);
}
