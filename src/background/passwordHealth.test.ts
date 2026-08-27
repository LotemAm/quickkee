// @vitest-environment node
import { analyzePasswordHealth, type PasswordHealthInput } from './passwordHealth';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 27);

function input(overrides: Partial<PasswordHealthInput> = {}): PasswordHealthInput {
  return {
    entryId: 'entry-1',
    title: 'Example',
    username: 'alice',
    url: 'https://example.com/login',
    password: 'correct horse battery staple',
    modifiedAt: NOW,
    expired: false,
    isCard: false,
    ...overrides,
  };
}

function issueCodes(entry: ReturnType<typeof analyzePasswordHealth>['entries'][number]) {
  return entry.issues.map(issue => issue.code);
}

describe('weak-password rules', () => {
  test.each([
    ['fewer than 12 Unicode code points', 'Abcdefghij!', 'short'],
    ['one repeated character', 'aaaaaaaaaaaa', 'single-character'],
    ['a repeated two-to-four-character motif', 'abcabcabcabc', 'repeated-pattern'],
    ['an obvious common password, case-insensitively', 'PaSsWoRd', 'common-password'],
    ['the normalized username', 'zzAlice!!secure', 'contains-username'],
    ['the first hostname label', 'EXAMPLE-long-secret', 'contains-site-name'],
  ])('flags %s', (_label, password, reason) => {
    const report = analyzePasswordHealth([input({ password })], NOW);
    expect(report.entries[0].issues).toContainEqual(expect.objectContaining({
      code: 'weak-password', reasons: expect.arrayContaining([reason]),
    }));
  });

  test('counts Unicode code points rather than UTF-16 code units', () => {
    const report = analyzePasswordHealth([input({ password: '🔐🔑🔒🔓🔔🔕🔖🔗🔘🔙🔚' })], NOW);
    expect(report.entries[0].issues).toContainEqual(expect.objectContaining({
      code: 'weak-password', reasons: expect.arrayContaining(['short']),
    }));
  });

  test('does not penalize a long lowercase passphrase', () => {
    const report = analyzePasswordHealth([input()], NOW);
    expect(report.entries).toEqual([]);
    expect(report.needsAttention).toBe(0);
  });

  test('reports overlapping transparent reasons once per weak issue', () => {
    const report = analyzePasswordHealth([input({ username: 'password-user', password: 'password' })], NOW);
    const weak = report.entries[0].issues.find(issue => issue.code === 'weak-password');
    expect(weak?.reasons).toEqual(expect.arrayContaining(['short', 'common-password']));
    expect(report.entries[0].issues.filter(issue => issue.code === 'weak-password')).toHaveLength(1);
  });
});

describe('reuse, age, and expiry checks', () => {
  test('groups two exact duplicate passwords without exposing their value', () => {
    const report = analyzePasswordHealth([
      input({ entryId: 'b', title: 'Beta', password: 'Distinctive-Reuse-Secret-42' }),
      input({ entryId: 'a', title: 'Alpha', password: 'Distinctive-Reuse-Secret-42' }),
    ], NOW);
    expect(report.counts['reused-password']).toBe(2);
    expect(report.entries.map(entry => entry.issues.find(issue => issue.code === 'reused-password')?.reuseGroupId))
      .toEqual(['reuse-1', 'reuse-1']);
  });

  test('assigns deterministic opaque IDs to three-entry and separate reuse groups', () => {
    const entries = [
      input({ entryId: 'z', title: 'Zulu', password: 'Three-Way-Reuse-Secret' }),
      input({ entryId: 'b', title: 'Beta', password: 'Other-Reuse-Secret' }),
      input({ entryId: 'y', title: 'Yankee', password: 'Three-Way-Reuse-Secret' }),
      input({ entryId: 'a', title: 'Alpha', password: 'Other-Reuse-Secret' }),
      input({ entryId: 'x', title: 'Xray', password: 'Three-Way-Reuse-Secret' }),
    ];
    const first = analyzePasswordHealth(entries, NOW);
    const second = analyzePasswordHealth([...entries].reverse(), NOW);
    expect(first).toEqual(second);
    expect(first.entries.filter(entry => entry.entryId === 'a' || entry.entryId === 'b')
      .map(entry => entry.issues.find(issue => issue.code === 'reused-password')?.reuseGroupId))
      .toEqual(['reuse-1', 'reuse-1']);
    expect(first.entries.filter(entry => ['x', 'y', 'z'].includes(entry.entryId))
      .map(entry => entry.issues.find(issue => issue.code === 'reused-password')?.reuseGroupId))
      .toEqual(['reuse-2', 'reuse-2', 'reuse-2']);
  });

  test('does not reuse-group empty passwords', () => {
    const report = analyzePasswordHealth([
      input({ entryId: 'a', title: 'Alpha', password: '' }),
      input({ entryId: 'b', title: 'Beta', password: '' }),
    ], NOW);
    expect(report.counts['empty-password']).toBe(2);
    expect(report.counts['reused-password']).toBe(0);
  });

  test('marks entries stale only when last modified more than 365 days ago', () => {
    const report = analyzePasswordHealth([
      input({ entryId: 'boundary', title: 'Boundary', password: 'boundary horse battery staple', modifiedAt: NOW - 365 * DAY }),
      input({ entryId: 'old', title: 'Old', password: 'old horse battery staple', modifiedAt: NOW - 365 * DAY - 1 }),
      input({ entryId: 'unknown', title: 'Unknown', password: 'unknown horse battery staple', modifiedAt: null }),
    ], NOW);
    expect(report.entries.find(entry => entry.entryId === 'boundary')).toBeUndefined();
    expect(issueCodes(report.entries.find(entry => entry.entryId === 'old')!)).toContain('stale-entry');
    expect(report.entries.find(entry => entry.entryId === 'unknown')).toBeUndefined();
  });

  test('reports normalized expiry', () => {
    const report = analyzePasswordHealth([
      input({ entryId: 'expired', title: 'Expired', password: 'expired horse battery staple', expired: true }),
    ], NOW);
    expect(issueCodes(report.entries.find(entry => entry.entryId === 'expired')!)).toContain('expired-entry');
    expect(report.needsAttention).toBe(1);
    expect(report.reviewCount).toBe(1);
  });
});

describe('scope, totals, ordering, and redaction', () => {
  test('excludes cards and pure secure notes supplied to the analyzer', () => {
    const report = analyzePasswordHealth([
      input({ entryId: 'card', isCard: true, password: 'password' }),
      input({ entryId: 'note', title: 'A note', username: '', url: '', password: '' }),
      input({ entryId: 'login', title: 'Login', username: 'user', url: '', password: '' }),
    ], NOW);
    expect(report.totalEntries).toBe(1);
    expect(report.entries.map(entry => entry.entryId)).toEqual(['login']);
  });

  test('counts unique attention/review entries and every issue category', () => {
    const report = analyzePasswordHealth([
      input({ entryId: 'multi', title: 'Multi', password: 'password', expired: true, modifiedAt: NOW - 400 * DAY }),
      input({ entryId: 'healthy', title: 'Healthy' }),
    ], NOW);
    expect(report).toMatchObject({ totalEntries: 2, needsAttention: 1, reviewCount: 1 });
    expect(report.counts).toEqual({
      'empty-password': 0,
      'weak-password': 1,
      'reused-password': 0,
      'stale-entry': 1,
      'expired-entry': 1,
    });
  });

  test('orders actionable, then review results with title tie-breaks', () => {
    const report = analyzePasswordHealth([
      input({ entryId: 'review', title: 'Review', password: 'review horse battery staple', expired: true }),
      input({ entryId: 'weak-b', title: 'Beta', password: 'short' }),
      input({ entryId: 'weak-a', title: 'Alpha', password: 'shorter' }),
      input({ entryId: 'empty', title: 'Empty', password: '' }),
    ], NOW);
    expect(report.entries.map(entry => entry.entryId)).toEqual(['empty', 'weak-a', 'weak-b', 'review']);
  });

  test('recursively redacts passwords and password-derived values from the complete report', () => {
    const secret = 'ZXQ-Unique-Fixture-Secret-938475';
    const report = analyzePasswordHealth([
      input({ entryId: 'one', title: 'One', password: secret }),
      input({ entryId: 'two', title: 'Two', password: secret }),
    ], NOW);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(Buffer.from(secret).toString('base64'));
    expect(serialized).not.toMatch(/[a-f0-9]{32,}/i);
    expect(Object.keys(report.entries[0])).not.toContain('password');
  });
});
