import { fireEvent, render, screen } from '@testing-library/react';
import type { TreeNode } from '../../shared/entry';
import type { TotpImportResult } from '../../shared/totpImport';
import { TotpImportDialog } from './TotpImportDialog';

const tree: TreeNode = {
  groupId: 'root', name: 'Root',
  entries: [{
    id: 'github-entry', title: 'GitHub login', username: 'alice@example.com', url: '',
    expired: false, isCard: false, hasTotp: false, totpPeriod: null, hasAttachments: false,
  }],
  children: [{
    groupId: 'work', name: 'Work', children: [],
    entries: [{
      id: 'acme-entry', title: 'Acme', username: 'bob@example.com', url: '',
      expired: false, isCard: false, hasTotp: true, totpPeriod: 30, hasAttachments: false,
    }],
  }],
};

const result: TotpImportResult = {
  provider: 'google-authenticator', warnings: [], keys: [
    {
      id: 'key-1', issuer: 'GitHub', account: 'alice@example.com',
      config: {
        secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30,
        issuer: 'GitHub', account: 'alice@example.com',
      },
    },
    {
      id: 'key-2', issuer: 'Acme', account: 'bob@example.com',
      config: {
        secret: 'GEZDGNBVGY3TQOJQ', algorithm: 'SHA256', digits: 8, period: 30,
        issuer: 'Acme', account: 'bob@example.com',
      },
    },
  ],
};

test('maps every imported key to a side-panel entry assignment', () => {
  const onConfirm = vi.fn();
  render(<TotpImportDialog result={result} tree={tree} defaultGroupId="root" onCancel={vi.fn()} onConfirm={onConfirm} />);

  fireEvent.change(screen.getByLabelText('Save GitHub — alice@example.com'), {
    target: { value: 'existing:github-entry' },
  });
  fireEvent.change(screen.getByLabelText('New entry group'), { target: { value: 'work' } });
  fireEvent.click(screen.getByRole('button', { name: 'Import 2 keys' }));

  expect(onConfirm).toHaveBeenCalledWith([
    {
      keyId: 'key-1', config: result.keys[0].config,
      destination: { type: 'existing', entryId: 'github-entry' },
    },
    {
      keyId: 'key-2', config: result.keys[1].config,
      destination: {
        type: 'new', groupId: 'work',
        fields: { Title: 'Acme', UserName: 'bob@example.com', Password: '', URL: '' },
      },
    },
  ]);
});

test('prevents assigning two imported keys to the same existing entry', () => {
  render(<TotpImportDialog result={result} tree={tree} defaultGroupId="root" onCancel={vi.fn()} onConfirm={vi.fn()} />);
  for (const label of ['Save GitHub — alice@example.com', 'Save Acme — bob@example.com']) {
    fireEvent.change(screen.getByLabelText(label), { target: { value: 'existing:github-entry' } });
  }

  expect(screen.getByRole('alert').textContent).toContain('same existing entry');
  expect((screen.getByRole('button', { name: 'Import 2 keys' }) as HTMLButtonElement).disabled).toBe(true);
});

test('warns before replacing an existing entry authenticator key', () => {
  render(<TotpImportDialog result={result} tree={tree} defaultGroupId="root" onCancel={vi.fn()} onConfirm={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Save Acme — bob@example.com'), {
    target: { value: 'existing:acme-entry' },
  });
  expect(screen.getByText('This replaces the entry’s current authenticator key.')).toBeTruthy();
});
