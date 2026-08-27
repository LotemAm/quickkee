import {
  PASSWORD_HEALTH_ISSUE_CODES,
  type PasswordHealthEntryResult,
  type PasswordHealthIssue,
  type PasswordHealthIssueCode,
  type PasswordHealthReport,
  type WeakPasswordReason,
} from '../shared/passwordHealth';

const STALE_AFTER_MS = 365 * 24 * 60 * 60 * 1000;

const COMMON_PASSWORDS = new Set([
  '123456', '123456789', '111111', '123123', 'abc123', 'admin', 'dragon',
  'football', 'iloveyou', 'letmein', 'monkey', 'password', 'password1',
  'qwerty', 'qwerty123', 'welcome',
]);

const ISSUE_PRIORITY: Record<PasswordHealthIssueCode, number> = {
  'empty-password': 0,
  'reused-password': 1,
  'weak-password': 2,
  'stale-entry': 3,
  'expired-entry': 3,
};

/** Background-only analyzer input. `password` must never cross the message boundary. */
export interface PasswordHealthInput {
  entryId: string;
  title: string;
  username: string;
  url: string;
  password: string;
  modifiedAt: number | null;
  expired: boolean;
  isCard: boolean;
}

function unicodeLength(value: string): number {
  return Array.from(value).length;
}

function allCharactersSame(value: string): boolean {
  const chars = Array.from(value);
  return chars.length > 0 && chars.every(char => char === chars[0]);
}

function isRepeatedMotif(value: string): boolean {
  const chars = Array.from(value);
  for (let size = 1; size <= Math.min(4, Math.floor(chars.length / 2)); size++) {
    if (chars.length % size !== 0) continue;
    if (chars.every((char, index) => char === chars[index % size])) return true;
  }
  return false;
}

function normalizedForContainment(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function firstHostnameLabel(url: string): string {
  try {
    const parsed = new URL(/^[a-z][a-z\d+.-]*:/i.test(url) ? url : `https://${url}`);
    return parsed.hostname.split('.')[0] ?? '';
  } catch {
    return '';
  }
}

function weakReasons(entry: PasswordHealthInput): WeakPasswordReason[] {
  const reasons: WeakPasswordReason[] = [];
  const password = entry.password;
  if (unicodeLength(password) < 12) reasons.push('short');
  const same = allCharactersSame(password);
  if (same) reasons.push('single-character');
  else if (isRepeatedMotif(password)) reasons.push('repeated-pattern');
  if (COMMON_PASSWORDS.has(password.toLocaleLowerCase())) reasons.push('common-password');

  const normalizedPassword = normalizedForContainment(password);
  const username = normalizedForContainment(entry.username.trim());
  if (unicodeLength(username) >= 4 && normalizedPassword.includes(username)) reasons.push('contains-username');
  const siteName = normalizedForContainment(firstHostnameLabel(entry.url));
  if (unicodeLength(siteName) >= 4 && normalizedPassword.includes(siteName)) reasons.push('contains-site-name');
  return reasons;
}

function compareText(a: string, b: string): number {
  const left = a.toLocaleLowerCase();
  const right = b.toLocaleLowerCase();
  return left < right ? -1 : left > right ? 1 : a < b ? -1 : a > b ? 1 : 0;
}

function compareMetadata(a: PasswordHealthInput, b: PasswordHealthInput): number {
  return compareText(a.title, b.title) || compareText(a.entryId, b.entryId);
}

function emptyCounts(): Record<PasswordHealthIssueCode, number> {
  return Object.fromEntries(PASSWORD_HEALTH_ISSUE_CODES.map(code => [code, 0])) as Record<PasswordHealthIssueCode, number>;
}

function isLoginEntry(entry: PasswordHealthInput): boolean {
  return !entry.isCard && Boolean(entry.url || entry.username || entry.password);
}

/**
 * Runs a deterministic, in-memory audit and returns only redacted metadata. Passwords are
 * used for this call's comparisons, but are never copied into a result or stable identifier.
 */
export function analyzePasswordHealth(inputs: PasswordHealthInput[], now = Date.now()): PasswordHealthReport {
  const audited = inputs.filter(isLoginEntry);
  const reuseCandidates = new Map<string, PasswordHealthInput[]>();
  for (const entry of audited) {
    if (!entry.password) continue;
    const group = reuseCandidates.get(entry.password) ?? [];
    group.push(entry);
    reuseCandidates.set(entry.password, group);
  }

  const reused = [...reuseCandidates.values()]
    .filter(group => group.length > 1)
    .map(group => [...group].sort(compareMetadata))
    .sort((a, b) => compareMetadata(a[0], b[0]));
  const reuseIds = new Map<string, string>();
  reused.forEach((group, index) => {
    const groupId = `reuse-${index + 1}`;
    for (const entry of group) reuseIds.set(entry.entryId, groupId);
  });

  const counts = emptyCounts();
  const entries: PasswordHealthEntryResult[] = [];
  let needsAttention = 0;
  let reviewCount = 0;

  for (const entry of audited) {
    const issues: PasswordHealthIssue[] = [];
    if (!entry.password) issues.push({ code: 'empty-password' });
    const reuseGroupId = reuseIds.get(entry.entryId);
    if (reuseGroupId) issues.push({ code: 'reused-password', reuseGroupId });
    if (entry.password) {
      const reasons = weakReasons(entry);
      if (reasons.length) issues.push({ code: 'weak-password', reasons });
    }
    if (entry.modifiedAt != null && now - entry.modifiedAt > STALE_AFTER_MS)
      issues.push({ code: 'stale-entry' });
    if (entry.expired) issues.push({ code: 'expired-entry' });
    if (!issues.length) continue;

    issues.sort((a, b) => ISSUE_PRIORITY[a.code] - ISSUE_PRIORITY[b.code]);
    for (const issue of issues) counts[issue.code]++;
    needsAttention++;
    if (issues.some(issue => issue.code === 'stale-entry' || issue.code === 'expired-entry')) reviewCount++;
    entries.push({
      entryId: entry.entryId,
      title: entry.title,
      username: entry.username,
      url: entry.url,
      modifiedAt: entry.modifiedAt,
      issues,
    });
  }

  entries.sort((a, b) => {
    const aPriority = Math.min(...a.issues.map(issue => ISSUE_PRIORITY[issue.code]));
    const bPriority = Math.min(...b.issues.map(issue => ISSUE_PRIORITY[issue.code]));
    return aPriority - bPriority || compareText(a.title, b.title) || compareText(a.entryId, b.entryId);
  });

  return { generatedAt: now, totalEntries: audited.length, needsAttention, reviewCount, counts, entries };
}
