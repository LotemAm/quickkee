export interface PwGenOpts { length: number; lower: boolean; upper: boolean; digits: boolean; symbols: boolean }
export const DEFAULT_PWGEN: PwGenOpts = { length: 20, lower: true, upper: true, digits: true, symbols: true };

const SETS = { lower: 'abcdefghijklmnopqrstuvwxyz', upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', digits: '0123456789', symbols: '!@#$%^&*()-_=+[]{};:,.<>?' };

function rand(max: number): number {
  const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % max;
}

export function generatePassword(opts: PwGenOpts): string {
  const classes = (['lower','upper','digits','symbols'] as const).filter(k => opts[k]).map(k => SETS[k]);
  if (classes.length === 0) throw new Error('no character class enabled');
  const all = classes.join('');
  const out: string[] = classes.map(c => c[rand(c.length)]); // guarantee one per class
  while (out.length < opts.length) out.push(all[rand(all.length)]);
  for (let i = out.length - 1; i > 0; i--) { const j = rand(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out.slice(0, opts.length).join('');
}
