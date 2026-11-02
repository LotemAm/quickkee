import { DEFAULT_NAMEGEN, generateName, normalizeNameGenOptions } from './namegen';
import { NAME_WORDS } from './namegenWords';

function randomValues(values: number[] = [0]) {
  let index = 0;
  vi.spyOn(crypto, 'getRandomValues').mockImplementation(array => {
    (array as Uint32Array)[0] = values[index++ % values.length];
    return array;
  });
}

afterEach(() => vi.restoreAllMocks());

test('curated lists have the required sizes, unique ASCII words, and 672 entries total', () => {
  const sizes = { adjectives: 128, nouns: 128, colors: 32, animals: 128, firstNames: 128, surnames: 128 };
  for (const [key, words] of Object.entries(NAME_WORDS)) {
    expect(words).toHaveLength(sizes[key as keyof typeof sizes]);
    expect(new Set(words).size).toBe(words.length);
    expect(words.every(word => /^[a-z]+$/.test(word))).toBe(true);
  }
  expect(Object.values(NAME_WORDS).flat()).toHaveLength(672);
});

test.each([
  ['adjective-noun', 'mellow-otter'],
  ['color-animal', 'amber-falcon'],
  ['noun-noun', 'otter-otter'],
  ['invented', 'bababa'],
  ['alias', 'sam-parker'],
] as const)('generates the %s style', (style, expected) => {
  randomValues();
  expect(generateName({ ...DEFAULT_NAMEGEN, style })).toBe(expected);
});

test.each(['-', '_', ''] as const)('formats paired names with separator %j and capitalized words', separator => {
  randomValues();
  expect(generateName({ ...DEFAULT_NAMEGEN, separator, casing: 'capitalized' })).toBe(`Mellow${separator}Otter`);
});

test.each([0, 2, 4] as const)('appends exactly %s digits, retaining leading zeros', digits => {
  randomValues();
  expect(generateName({ ...DEFAULT_NAMEGEN, separator: '', digits })).toBe(`mellowotter${'0'.repeat(digits)}`);
});

test('invented names use three consonant-vowel syllables and ignore separators', () => {
  randomValues([1, 2, 3, 4, 5, 6]);
  const result = generateName({ ...DEFAULT_NAMEGEN, style: 'invented', separator: '_', casing: 'capitalized' });
  expect(result).toMatch(/^[BCDFGHJKLMNPRSTVWZ][aeiou](?:[bcdfghjklmnprstvwz][aeiou]){2}$/);
});

test('randomness reaches the end of each curated list', () => {
  for (const [style, first, second] of [
    ['adjective-noun', NAME_WORDS.adjectives, NAME_WORDS.nouns],
    ['color-animal', NAME_WORDS.colors, NAME_WORDS.animals],
    ['noun-noun', NAME_WORDS.nouns, NAME_WORDS.nouns],
    ['alias', NAME_WORDS.firstNames, NAME_WORDS.surnames],
  ] as const) {
    randomValues([first.length - 1, second.length - 1]);
    expect(generateName({ ...DEFAULT_NAMEGEN, style })).toBe(`${first.at(-1)}-${second.at(-1)}`);
  }
});

test('normalizes missing and invalid preferences individually', () => {
  for (const invalid of [undefined, null, false, 'bad', []]) expect(normalizeNameGenOptions(invalid)).toEqual(DEFAULT_NAMEGEN);
  expect(normalizeNameGenOptions({ style: 'alias', separator: ' ', casing: 'UPPER', digits: 3 })).toEqual({
    ...DEFAULT_NAMEGEN, style: 'alias',
  });
  expect(normalizeNameGenOptions({ separator: '', digits: 4 })).toEqual({ ...DEFAULT_NAMEGEN, separator: '', digits: 4 });
});
