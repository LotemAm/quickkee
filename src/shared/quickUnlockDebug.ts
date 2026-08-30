type QuickUnlockDebugValue = string | number | boolean | null | undefined;
type QuickUnlockDebugDetails = Record<string, QuickUnlockDebugValue>;

const PREFIX = '[QuickKee quick unlock]';

function compact(details: QuickUnlockDebugDetails): Record<string, Exclude<QuickUnlockDebugValue, undefined>> {
  return Object.fromEntries(
    Object.entries(details).filter((entry): entry is [string, Exclude<QuickUnlockDebugValue, undefined>] =>
      entry[1] !== undefined),
  );
}

function safeError(error: unknown): QuickUnlockDebugDetails {
  if (!(error instanceof Error)) return { errorType: typeof error };
  const code = (error as Error & { code?: unknown }).code;
  return {
    errorName: error.name || error.constructor.name,
    errorCode: typeof code === 'string' || typeof code === 'number' ? code : undefined,
  };
}

/** Local-only diagnostics. Callers must pass metadata, never secret values or identifiers. */
export function quickUnlockInfo(stage: string, details: QuickUnlockDebugDetails = {}): void {
  console.info(PREFIX, stage, compact(details));
}

export function quickUnlockWarn(
  stage: string,
  error?: unknown,
  details: QuickUnlockDebugDetails = {},
): void {
  console.warn(PREFIX, stage, compact({ ...details, ...(error === undefined ? {} : safeError(error)) }));
}
