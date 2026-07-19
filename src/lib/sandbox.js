// Simulated responses for sandbox API keys — no charge, no provider call.
import crypto from 'crypto';

const id = (p) => p + crypto.randomBytes(8).toString('hex');
const iccid = () => '8900' + String(Math.floor(Math.random() * 1e15)).padStart(15, '0');

export const sandboxPayment = (extra = {}) => ({
  success: true, sandbox: true, transactionId: id('sbx_'), status: 'COMPLETED',
  message: 'Sandbox: операция симулирована, средства не списаны', ...extra,
});

export const sandboxEsim = (count = 1) => ({
  success: true, sandbox: true, transactionId: id('sbx_'), count,
  message: 'Sandbox: eSIM симулирована',
  esims: Array.from({ length: count }, () => ({ iccid: iccid(), qrcode: 'LPA:1$sandbox.smdp$TEST-SANDBOX-KEY', img: null, status: 'Released' })),
});

export const sandboxVpn = () => ({
  success: true, sandbox: true, transactionId: id('sbx_'),
  message: 'Sandbox: VPN-ключ симулирован',
  key: { id: id('sbx_'), location: 'Sandbox, Test', protocol: 'vless', config: 'vless://00000000-0000-0000-0000-000000000000@sandbox.test:443?type=tcp#Sandbox', qr: null, expiresAt: new Date(Date.now() + 30 * 86400 * 1000).toISOString() },
});
