export const PASSWORD_HEALTH_ISSUE_CODES = [
  'empty-password',
  'weak-password',
  'reused-password',
  'stale-entry',
  'expired-entry',
] as const;

export type PasswordHealthIssueCode = typeof PASSWORD_HEALTH_ISSUE_CODES[number];

export type WeakPasswordReason =
  | 'short'
  | 'single-character'
  | 'repeated-pattern'
  | 'common-password'
  | 'contains-username'
  | 'contains-site-name';

export interface PasswordHealthIssue {
  code: PasswordHealthIssueCode;
  reasons?: WeakPasswordReason[];
  reuseGroupId?: string;
}

/** Redacted entry metadata safe to send from the background vault to extension UI. */
export interface PasswordHealthEntryResult {
  entryId: string;
  title: string;
  username: string;
  url: string;
  modifiedAt: number | null;
  issues: PasswordHealthIssue[];
}

export interface PasswordHealthReport {
  generatedAt: number;
  totalEntries: number;
  needsAttention: number;
  reviewCount: number;
  counts: Record<PasswordHealthIssueCode, number>;
  entries: PasswordHealthEntryResult[];
}
