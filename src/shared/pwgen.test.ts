import { generatePassword, DEFAULT_PWGEN } from './pwgen';

test('respects length', () => {
  expect(generatePassword({ ...DEFAULT_PWGEN, length: 16 })).toHaveLength(16);
});
test('only digits when only digits enabled', () => {
  const pw = generatePassword({ length: 40, lower: false, upper: false, digits: true, symbols: false });
  expect(pw).toMatch(/^[0-9]+$/);
});
test('includes at least one of each enabled class', () => {
  const pw = generatePassword({ length: 8, lower: true, upper: true, digits: true, symbols: true });
  expect(pw).toMatch(/[a-z]/); expect(pw).toMatch(/[A-Z]/);
  expect(pw).toMatch(/[0-9]/); expect(pw).toMatch(/[^a-zA-Z0-9]/);
});
