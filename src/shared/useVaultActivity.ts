import { useEffect } from 'react';
import { createVaultActivityListener } from './vaultActivity';

export function useVaultActivity(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onActivity = createVaultActivityListener();
    document.addEventListener('pointerdown', onActivity, true);
    document.addEventListener('keydown', onActivity, true);
    return () => {
      document.removeEventListener('pointerdown', onActivity, true);
      document.removeEventListener('keydown', onActivity, true);
    };
  }, [enabled]);
}
