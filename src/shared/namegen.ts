import { NAME_WORDS } from './namegenWords';

export interface NameGenOptions {
  style: 'adjective-noun' | 'color-animal' | 'noun-noun' | 'invented' | 'alias';
  separator: '-' | '_' | '';
  casing: 'lowercase' | 'capitalized';
  digits: 0 | 2 | 4;
}

export const DEFAULT_NAMEGEN: NameGenOptions = {
  style: 'adjective-noun', separator: '-', casing: 'lowercase', digits: 0,
};

export function normalizeNameGenOptions(value: unknown): NameGenOptions {
  const opts = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    style: ['adjective-noun', 'color-animal', 'noun-noun', 'invented', 'alias'].includes(opts.style as string)
      ? opts.style as NameGenOptions['style'] : DEFAULT_NAMEGEN.style,
    separator: opts.separator === '-' || opts.separator === '_' || opts.separator === '' ? opts.separator : DEFAULT_NAMEGEN.separator,
    casing: opts.casing === 'lowercase' || opts.casing === 'capitalized' ? opts.casing : DEFAULT_NAMEGEN.casing,
    digits: opts.digits === 0 || opts.digits === 2 || opts.digits === 4 ? opts.digits : DEFAULT_NAMEGEN.digits,
  };
}

function randomIndex(max: number): number {
  const value = new Uint32Array(1);
  const limit = 0x100000000 - (0x100000000 % max);
  do { crypto.getRandomValues(value); } while (value[0] >= limit);
  return value[0] % max;
}

function pick(words: readonly string[]): string { return words[randomIndex(words.length)]; }

export function generateName(options: NameGenOptions): string {
  const opts = normalizeNameGenOptions(options);
  let words: string[];
  switch (opts.style) {
    case 'adjective-noun': words = [pick(NAME_WORDS.adjectives), pick(NAME_WORDS.nouns)]; break;
    case 'color-animal': words = [pick(NAME_WORDS.colors), pick(NAME_WORDS.animals)]; break;
    case 'noun-noun': words = [pick(NAME_WORDS.nouns), pick(NAME_WORDS.nouns)]; break;
    case 'alias': words = [pick(NAME_WORDS.firstNames), pick(NAME_WORDS.surnames)]; break;
    case 'invented': {
      const consonants = 'bcdfghjklmnprstvwz';
      const vowels = 'aeiou';
      words = [Array.from({ length: 3 }, () => consonants[randomIndex(consonants.length)] + vowels[randomIndex(vowels.length)]).join('')];
      break;
    }
  }
  const name = words.map(word => opts.casing === 'capitalized' ? word[0].toUpperCase() + word.slice(1) : word).join(opts.separator);
  return name + Array.from({ length: opts.digits }, () => String(randomIndex(10))).join('');
}
