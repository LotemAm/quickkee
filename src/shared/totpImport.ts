import type { TotpConfig } from '../background/totp';

export interface TotpImportKey {
  id: string;
  issuer: string;
  account: string;
  config: TotpConfig;
}

export interface TotpImportBatch {
  id: number;
  size: number;
  index: number;
}

export interface TotpImportChunk {
  provider: string;
  keys: TotpImportKey[];
  warnings: string[];
  batch?: TotpImportBatch;
}

export interface TotpImportResult {
  provider: string;
  keys: TotpImportKey[];
  warnings: string[];
}

export interface TotpImporter {
  readonly id: string;
  readonly label: string;
  parse(value: string): TotpImportChunk;
}

export type TotpImportAssignment = {
  keyId: string;
  config: TotpConfig;
  destination:
    | { type: 'existing'; entryId: string }
    | { type: 'new'; groupId: string; fields: Record<string, string> };
};

export function mergeTotpImportChunks(chunks: TotpImportChunk[]): TotpImportResult {
  if (chunks.length === 0) throw new Error('No export QR codes selected');
  const provider = chunks[0].provider;
  if (chunks.some(chunk => chunk.provider !== provider)) throw new Error('Export QR codes are from different apps');

  const batched = chunks.filter(chunk => chunk.batch);
  if (batched.length === 0) {
    return {
      provider,
      keys: chunks.flatMap(chunk => chunk.keys),
      warnings: chunks.flatMap(chunk => chunk.warnings),
    };
  }
  if (batched.length !== chunks.length) throw new Error('Export QR codes do not belong to one batch');

  const expected = batched[0].batch!;
  if (batched.some(chunk => chunk.batch!.id !== expected.id || chunk.batch!.size !== expected.size)) {
    throw new Error('Export QR codes do not belong to one batch');
  }

  const byIndex = new Map<number, TotpImportChunk>();
  for (const chunk of batched) {
    const index = chunk.batch!.index;
    if (index < 0 || index >= expected.size) throw new Error('Export QR code has invalid batch information');
    if (byIndex.has(index)) throw new Error(`Export QR code ${index + 1} was selected more than once`);
    byIndex.set(index, chunk);
  }
  for (let index = 0; index < expected.size; index++) {
    if (!byIndex.has(index)) throw new Error(`Missing export QR code ${index + 1} of ${expected.size}`);
  }

  const ordered = Array.from(byIndex.values()).sort((a, b) => a.batch!.index - b.batch!.index);
  return {
    provider,
    keys: ordered.flatMap(chunk => chunk.keys),
    warnings: ordered.flatMap(chunk => chunk.warnings),
  };
}
