export function maskCardNumber(value: string): string {
  if (value.length <= 4) return value;
  return `•••• ${value.slice(-4)}`;
}
