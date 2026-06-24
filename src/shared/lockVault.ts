import { sendToSW } from './messages';

/**
 * Lock the vault. If there are pending (dirty) changes, prompt the user
 * whether to save them first. OK = save & lock, Cancel = lock without saving.
 */
export async function lockVault(dirty: boolean): Promise<void> {
  if (dirty && window.confirm('You have unsaved changes. Save before locking?')) {
    await sendToSW({ type: 'save' });
  }
  await sendToSW({ type: 'lock' });
}
