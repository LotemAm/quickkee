import { useEffect, useRef, useState } from 'react';
import { MoreVertical, QrCode, Settings } from 'lucide-react';

export function PanelActionsMenu({ onImportTotp, importBusy = false }: { onImportTotp: () => void; importBusy?: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const firstItem = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    firstItem.current?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button className="icon-btn" aria-label="More actions" title="More actions"
        aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <MoreVertical size={16} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-44 rounded-lg p-1"
          style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }}>
          <button ref={firstItem} type="button" role="menuitem"
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--btn-bg)] disabled:opacity-50"
            style={{ color: 'var(--text)' }}
            disabled={importBusy}
            onClick={() => { setOpen(false); onImportTotp(); }}>
            <QrCode size={15} style={{ color: 'var(--primary-text)' }} />
            {importBusy ? 'Reading TOTP…' : 'Import TOTP'}
          </button>
          <button type="button" role="menuitem"
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--btn-bg)]"
            style={{ color: 'var(--text)' }}
            onClick={() => { setOpen(false); void chrome.runtime.openOptionsPage(); }}>
            <Settings size={15} style={{ color: 'var(--primary-text)' }} />
            Settings
          </button>
        </div>
      )}
    </div>
  );
}
