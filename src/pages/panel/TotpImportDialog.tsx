import { useMemo, useState } from 'react';
import { AlertTriangle, KeyRound, X } from 'lucide-react';
import type { TreeNode } from '../../shared/entry';
import type { TotpImportAssignment, TotpImportKey, TotpImportResult } from '../../shared/totpImport';

interface EntryOption {
  id: string;
  label: string;
  hasTotp: boolean;
}

interface GroupOption {
  id: string;
  label: string;
}

function collectOptions(node: TreeNode, parentPath = ''): { entries: EntryOption[]; groups: GroupOption[] } {
  const path = parentPath ? `${parentPath} / ${node.name}` : node.name;
  const entries = node.entries
    .filter(entry => !entry.isCard)
    .map(entry => ({
      id: entry.id,
      label: `${path} / ${entry.title || '(untitled)'}${entry.username ? ` — ${entry.username}` : ''}`,
      hasTotp: entry.hasTotp,
    }));
  const groups: GroupOption[] = [{ id: node.groupId, label: path }];
  for (const child of node.children) {
    const childOptions = collectOptions(child, path);
    entries.push(...childOptions.entries);
    groups.push(...childOptions.groups);
  }
  return { entries, groups };
}

function keyLabel(key: TotpImportKey): string {
  if (key.issuer && key.account) return `${key.issuer} — ${key.account}`;
  return key.issuer || key.account || 'Unnamed account';
}

function newEntryFields(key: TotpImportKey): Record<string, string> {
  return {
    Title: key.issuer || key.account || 'Authenticator',
    UserName: key.account,
    Password: '',
    URL: '',
  };
}

export function TotpImportDialog({ result, tree, defaultGroupId, onCancel, onConfirm, busy = false, error = '' }: {
  result: TotpImportResult;
  tree: TreeNode;
  defaultGroupId: string;
  onCancel: () => void;
  onConfirm: (assignments: TotpImportAssignment[]) => void;
  busy?: boolean;
  error?: string;
}) {
  const options = useMemo(() => collectOptions(tree), [tree]);
  const initialGroup = options.groups.some(group => group.id === defaultGroupId) ? defaultGroupId : tree.groupId;
  const [newEntryGroupId, setNewEntryGroupId] = useState(initialGroup);
  const [destinations, setDestinations] = useState<Record<string, string>>({});

  const existingIds = result.keys
    .map(key => destinations[key.id] ?? 'new')
    .filter(value => value.startsWith('existing:'))
    .map(value => value.slice('existing:'.length));
  const hasDuplicateDestination = new Set(existingIds).size !== existingIds.length;

  function confirmImport() {
    if (hasDuplicateDestination || busy) return;
    const assignments = result.keys.map<TotpImportAssignment>(key => {
      const destination = destinations[key.id] ?? 'new';
      if (destination.startsWith('existing:')) {
        return {
          keyId: key.id,
          config: key.config,
          destination: { type: 'existing', entryId: destination.slice('existing:'.length) },
        };
      }
      return {
        keyId: key.id,
        config: key.config,
        destination: { type: 'new', groupId: newEntryGroupId, fields: newEntryFields(key) },
      };
    });
    onConfirm(assignments);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'rgba(0, 0, 0, .48)' }}>
      <div className="card w-full max-w-3xl max-h-full flex flex-col" role="dialog" aria-modal="true" aria-labelledby="totp-import-title">
        <div className="flex items-start gap-3 pb-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <KeyRound size={20} className="shrink-0 mt-0.5" style={{ color: 'var(--primary)' }} />
          <div className="min-w-0 flex-1">
            <h2 id="totp-import-title" className="font-semibold">Import authenticator keys</h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Choose where each imported key should be stored.
            </p>
          </div>
          <button className="icon-btn" aria-label="Close import" title="Close" onClick={onCancel} disabled={busy}>
            <X size={16} />
          </button>
        </div>

        <div className="overflow-auto py-3 space-y-3">
          <label className="block text-xs" style={{ color: 'var(--text-muted)' }}>
            New entry group
            <select className="input mt-1" aria-label="New entry group" value={newEntryGroupId}
              onChange={event => setNewEntryGroupId(event.target.value)}>
              {options.groups.map(group => <option key={group.id} value={group.id}>{group.label}</option>)}
            </select>
          </label>

          {result.keys.map(key => {
            const destination = destinations[key.id] ?? 'new';
            const selectedEntry = destination.startsWith('existing:')
              ? options.entries.find(entry => entry.id === destination.slice('existing:'.length))
              : undefined;
            return (
              <div key={key.id} className="rounded-lg p-3" style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{keyLabel(key)}</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {key.config.algorithm} · {key.config.digits} digits · {key.config.period}s
                    </div>
                  </div>
                  <select className="input max-w-md" aria-label={`Save ${keyLabel(key)}`} value={destination}
                    onChange={event => setDestinations(current => ({ ...current, [key.id]: event.target.value }))}>
                    <option value="new">Create a new entry</option>
                    <optgroup label="Use an existing entry">
                      {options.entries.map(entry => (
                        <option key={entry.id} value={`existing:${entry.id}`}>
                          {entry.label}{entry.hasTotp ? ' (has authenticator key)' : ''}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>
                {selectedEntry?.hasTotp && (
                  <p className="text-xs flex items-center gap-1" style={{ color: 'var(--danger-text)' }}>
                    <AlertTriangle size={12} /> This replaces the entry’s current authenticator key.
                  </p>
                )}
              </div>
            );
          })}

          {result.warnings.map((warning, index) => (
            <p key={`${warning}-${index}`} className="alert-error" role="status">{warning}</p>
          ))}
          {hasDuplicateDestination && (
            <p className="alert-error" role="alert">Two imported keys cannot use the same existing entry.</p>
          )}
          {error && <p className="alert-error" role="alert">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
          <button className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn-primary" onClick={confirmImport} disabled={hasDuplicateDestination || busy}>
            {busy ? 'Importing…' : `Import ${result.keys.length} ${result.keys.length === 1 ? 'key' : 'keys'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
