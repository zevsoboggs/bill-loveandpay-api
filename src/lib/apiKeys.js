import crypto from 'crypto';

// Public key id (sent as X-API-Key) + a longer secret (sent as X-API-Secret).
export function generateApiKey() {
  return 'lk_' + crypto.randomBytes(16).toString('hex'); // lk = loveandpay key
}

export function generateApiSecret() {
  return 'ls_' + crypto.randomBytes(32).toString('hex'); // ls = loveandpay secret
}

// Constant-time compare to avoid timing leaks on the secret.
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Normalise an inbound IP (strip IPv6-mapped IPv4 prefix).
export function normalizeIp(ip) {
  if (!ip) return ip;
  return ip.replace(/^::ffff:/, '').trim();
}
