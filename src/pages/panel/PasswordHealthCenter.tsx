import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, Info, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { sendToSW } from '../../shared/messages';
import type {
  PasswordHealthEntryResult,
  PasswordHealthIssue,
  PasswordHealthReport,
  WeakPasswordReason,
} from '../../shared/passwordHealth';

type HealthFilter = 'all' | 'weak' | 'reused' | 'review';

const WEAK_REASON_TEXT: Record<WeakPasswordReason, string> = {
  short: 'Fewer than 12 Unicode characters.',
  'single-character': 'Uses one repeated character.',
  'repeated-pattern': 'Repeats a one-to-four-character pattern.',
  'common-password': 'Matches an obvious common password.',
  'contains-username': 'Contains the username.',
  'contains-site-name': 'Contains the site name.',
};

const ISSUE_LABELS: Record<PasswordHealthIssue['code'], string> = {
  'empty-password': 'Empty',
  'weak-password': 'Weak',
  'reused-password': 'Reused',
  'stale-entry': 'Review',
  'expired-entry': 'Expired',
};

function issueText(issue: PasswordHealthIssue): string {
  switch (issue.code) {
    case 'empty-password': return 'No password is stored.';
    case 'weak-password': return (issue.reasons ?? []).map(reason => WEAK_REASON_TEXT[reason]).join(' ');
    case 'reused-password': return 'The same password is used by another login in this vault.';
    case 'stale-entry': return 'Entry not updated in over a year. This may not reflect when the password changed.';
    case 'expired-entry': return 'KeePass marks this entry expired.';
  }
}

function hostname(url: string): string {
  if (!url) return '';
  try { return new URL(/^[a-z][a-z\d+.-]*:/i.test(url) ? url : `https://${url}`).hostname; }
  catch { return url; }
}

function checkedLabel(generatedAt: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - generatedAt) / 60_000));
  if (minutes === 0) return 'Checked just now';
  if (minutes === 1) return 'Checked 1 minute ago';
  return `Checked ${minutes} minutes ago`;
}

function matchesFilter(entry: PasswordHealthEntryResult, filter: HealthFilter): boolean {
  const codes = new Set(entry.issues.map(issue => issue.code));
  if (filter === 'all') return true;
  if (filter === 'weak') return codes.has('empty-password') || codes.has('weak-password');
  if (filter === 'reused') return codes.has('reused-password');
  return codes.has('stale-entry') || codes.has('expired-entry');
}

function HealthRow({ entry, onOpen }: { entry: PasswordHealthEntryResult; onOpen: () => void }) {
  const host = hostname(entry.url);
  return (
    <article className="card" aria-labelledby={`health-entry-${entry.entryId}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 id={`health-entry-${entry.entryId}`} className="truncate text-sm font-semibold">{entry.title || '(untitled)'}</h3>
          {(entry.username || host) && (
            <p className="mt-0.5 truncate text-xs" style={{ color: 'var(--text-muted)' }}>
              {[entry.username, host].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        <button className="btn-xs shrink-0" aria-label="Open entry" onClick={onOpen}>
          <ExternalLink size={12} /> Open entry
        </button>
      </div>
      <div className="mt-3 space-y-2">
        {entry.issues.map(issue => (
          <div key={issue.code} className="flex items-start gap-2 text-xs">
            <span className="badge badge-danger">
              {ISSUE_LABELS[issue.code]}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>{issueText(issue)}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

export function PasswordHealthCenter({ onOpenEntry }: {
  onOpenEntry: (entryId: string) => boolean | Promise<boolean>;
}) {
  const [report, setReport] = useState<PasswordHealthReport | null>(null);
  const [filter, setFilter] = useState<HealthFilter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState('');

  const check = useCallback(async () => {
    setLoading(true);
    setError(false);
    setNotice('');
    try {
      const response = await sendToSW({ type: 'getPasswordHealthReport' });
      if (!response.ok) { setError(true); return; }
      setReport(response.report);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void check(); }, [check]);

  async function openEntry(entryId: string) {
    let opened = false;
    try { opened = await onOpenEntry(entryId); } catch { opened = false; }
    if (opened) return;
    await check();
    setNotice('That entry is no longer available. The report was refreshed.');
  }

  if (loading && !report) return (
    <div className="flex flex-1 items-center justify-center p-8" role="status">
      <Loader2 size={20} className="animate-spin" />
      <span className="ml-2 text-sm" style={{ color: 'var(--text-muted)' }}>Checking password health…</span>
    </div>
  );

  if (error && !report) return (
    <div className="m-auto max-w-sm p-6 text-center">
      <AlertTriangle size={24} className="mx-auto mb-3" style={{ color: 'var(--danger)' }} />
      <p className="alert-error" role="alert">Could not check password health. Try again.</p>
      <button className="btn mt-3" aria-label="Try again" onClick={() => void check()}>
        <RefreshCw size={14} /> Try again
      </button>
    </div>
  );

  if (!report) return null;
  const weakEmpty = report.counts['empty-password'] + report.counts['weak-password'];
  const filterCounts: Record<HealthFilter, number> = {
    all: report.entries.length,
    weak: report.entries.filter(entry => matchesFilter(entry, 'weak')).length,
    reused: report.counts['reused-password'],
    review: report.reviewCount,
  };
  const shown = report.entries.filter(entry => matchesFilter(entry, filter));
  const filters: Array<{ id: HealthFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'weak', label: 'Weak / empty' },
    { id: 'reused', label: 'Reused' },
    { id: 'review', label: 'Review' },
  ];

  return (
    <main className="flex-1 overflow-auto p-4" aria-labelledby="password-health-title">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 id="password-health-title" className="flex items-center gap-2 text-lg font-semibold">
              <ShieldCheck size={20} style={{ color: 'var(--primary)' }} /> Password Health
            </h1>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
              Checks run locally while your vault is unlocked.
            </p>
          </div>
          <button className="btn" aria-label="Recheck password health" disabled={loading} onClick={() => void check()}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {loading ? 'Checking' : 'Recheck'}
          </button>
        </div>

        <section className="mt-5 rounded-xl border p-4" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <p className="text-base font-semibold">{report.needsAttention} of {report.totalEntries} login entries need attention</p>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>{checkedLabel(report.generatedAt)}</p>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              ['Weak or empty', weakEmpty],
              ['Reused', report.counts['reused-password']],
              ['Review', report.reviewCount],
            ].map(([label, count]) => (
              <div key={label} className="rounded-lg border p-3" style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}>
                <div className="text-lg font-semibold">{count}</div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</div>
              </div>
            ))}
          </div>
        </section>

        {notice && <p className="mt-3 flex items-center gap-2 text-xs" role="status" style={{ color: 'var(--text-muted)' }}>
          <Info size={13} /> {notice}
        </p>}
        {error && <p className="alert-error mt-3" role="alert">
          Could not refresh password health. The previous results are still shown; recheck to try again.
        </p>}

        {report.totalEntries === 0 ? (
          <div className="empty-state mt-8">No login entries to check yet.</div>
        ) : report.entries.length === 0 ? (
          <div className="empty-state mt-8">No issues found by these checks.</div>
        ) : (
          <>
            <nav className="mt-4 flex flex-wrap gap-2" aria-label="Password health filters">
              {filters.map(item => (
                <button key={item.id} className="btn-xs" aria-pressed={filter === item.id}
                  aria-label={`${item.label} ${filterCounts[item.id]}`}
                  onClick={() => setFilter(item.id)}>
                  {item.label} <span aria-hidden="true">{filterCounts[item.id]}</span>
                </button>
              ))}
            </nav>
            <section className="mt-3 grid gap-3" aria-label="Password health results">
              {shown.length
                ? shown.map(entry => <HealthRow key={entry.entryId} entry={entry} onOpen={() => void openEntry(entry.entryId)} />)
                : <div className="empty-state">No entries in this filter.</div>}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
