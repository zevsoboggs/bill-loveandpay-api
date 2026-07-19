// USDT money helpers. Balances are stored as Decimal(20,6); we do arithmetic in
// JS numbers (safe at USDT magnitudes) and round to 6 dp before persisting.
export const toNum = (v) => (v == null ? 0 : Number(v));
export const round6 = (n) => Math.round((Number(n) + Number.EPSILON) * 1e6) / 1e6;
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Balance column name per service.
export const systemBalanceField = (system) =>
  ({ SBP: 'sbpBalance', PROMPTPAY: 'promptpayBalance', ESIM: 'esimBalance', VPN: 'vpnBalance', AML: 'amlBalance' }[system] || 'promptpayBalance');

export const balanceTypeForSystem = (system) =>
  ({ SBP: 'SBP', PROMPTPAY: 'PROMPTPAY', ESIM: 'ESIM', VPN: 'VPN', AML: 'AML' }[system] || 'PROMPTPAY');

// Balance column name per balance type (incl. the deposit pool).
export const balanceFieldFor = (balanceType) =>
  ({ DEPOSIT: 'depositBalance', SBP: 'sbpBalance', PROMPTPAY: 'promptpayBalance', ESIM: 'esimBalance', VPN: 'vpnBalance', AML: 'amlBalance' }[balanceType]);

// Recursively convert Prisma Decimal instances to plain numbers so JSON responses
// carry numbers (not decimal strings) for the Refine/AntD frontend.
export function serialize(input) {
  if (input == null) return input;
  if (Array.isArray(input)) return input.map(serialize);
  if (typeof input === 'object') {
    if (input instanceof Date) return input.toISOString();
    // Prisma Decimal exposes toNumber(); Dates are handled above.
    if (typeof input.toNumber === 'function') return input.toNumber();
    const out = {};
    for (const [k, v] of Object.entries(input)) out[k] = serialize(v);
    return out;
  }
  return input;
}
