export function shouldWarnCertError(details: { error?: string }): boolean {
  return !!details.error && /ERR_CERT|SSL|ERR_SSL/i.test(details.error);
}
