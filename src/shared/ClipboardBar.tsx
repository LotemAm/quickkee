import { X } from 'lucide-react';
import type { ClipboardTimerState } from './useClipboardTimer';

export function ClipboardBar({ state, onCancel }: { state: ClipboardTimerState; onCancel: () => void }) {
  return (
    <div style={{
      position: 'relative',
      height: '28px',
      background: 'var(--primary-tint)',
      display: 'flex',
      alignItems: 'center',
      paddingRight: '4px',
    }}>
      <div
        data-testid="clipboard-bar-fill"
        style={{
          position: 'absolute',
          inset: 0,
          background: 'var(--primary)',
          width: `${state.progress * 100}%`,
          opacity: 0.25,
          transition: 'width 0.1s linear',
        }}
      />
      <span style={{
        position: 'relative',
        flex: 1,
        fontSize: '12px',
        color: 'var(--primary-text)',
        paddingLeft: '10px',
      }}>
        {state.label} copied
      </span>
      <button
        className="icon-btn-xs"
        style={{ position: 'relative' }}
        aria-label="Cancel clipboard clear"
        title="Cancel clipboard clear"
        onClick={onCancel}
      >
        <X size={12} />
      </button>
    </div>
  );
}
