export const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function normalizeDomain(value) {
  return String(value).trim().toLowerCase().replace(/\.$/, '');
}

export function normalizeEmail(value) {
  const email = String(value).trim().toLowerCase();
  const parts = email.split('@');
  if (parts.length !== 2 || !parts[0] || parts[0].length > 64 || !domainPattern.test(parts[1])) return null;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(parts[0])) return null;
  return email;
}
