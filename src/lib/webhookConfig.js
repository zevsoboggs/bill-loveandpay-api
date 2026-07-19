// Shared webhook-config handlers, used by both the cabinet and the relay API.
import prisma from '../db.js';
import { generateWebhookSecret } from './apiKeys.js';
import { deliver, EVENTS } from '../services/webhooks.js';
import { serialize } from './money.js';

// Human-readable catalog + a sample payload for each event (for test sends).
export const EVENT_CATALOG = [
  { event: EVENTS.DEPOSIT_CREDITED, label: 'Депозит зачислен', sample: { amountUsdt: 1000, network: 'TRC-20', source: 'on-chain' } },
  { event: EVENTS.PAYMENT_COMPLETED, label: 'Платёж выполнен', sample: { system: 'SBP', amountUsdt: 15.42, sourceAmount: 1500, sourceCurrency: 'RUB' } },
  { event: EVENTS.PAYMENT_FAILED, label: 'Платёж не прошёл', sample: { system: 'PROMPTPAY', amountUsdt: 8.1, error: 'PROMPTPAY_FAILED' } },
  { event: EVENTS.ESIM_ISSUED, label: 'eSIM выпущен', sample: { planName: 'Europe 5GB', country: 'EU', count: 1, amountUsdt: 6.3 } },
  { event: EVENTS.VPN_ISSUED, label: 'VPN-ключ выпущен', sample: { location: 'Germany, Frankfurt', protocol: 'vless', amountUsdt: 3.6 } },
];
const EVENT_LIST = Object.values(EVENTS);
const SAMPLES = Object.fromEntries(EVENT_CATALOG.map((e) => [e.event, e.sample]));

export async function getConfig(client) {
  // Ensure a secret exists so the client can verify signatures.
  let secret = client.webhookSecret;
  if (!secret) {
    secret = generateWebhookSecret();
    await prisma.client.update({ where: { id: client.id }, data: { webhookSecret: secret } });
  }
  return {
    url: client.webhookUrl || null,
    enabled: client.webhookEnabled,
    secret,
    events: EVENT_LIST,
    catalog: EVENT_CATALOG.map(({ event, label }) => ({ event, label })),
    subscribedEvents: client.webhookEvents || [], // empty = all events
  };
}

export async function updateConfig(clientId, { url, enabled, events }) {
  const data = {};
  if (url !== undefined) data.webhookUrl = url ? String(url).trim() : null;
  if (enabled !== undefined) data.webhookEnabled = !!enabled;
  if (events !== undefined) {
    const clean = Array.isArray(events) ? events.filter((e) => EVENT_LIST.includes(e)) : [];
    data.webhookEvents = clean;
  }
  // Auto-generate a secret on first configuration.
  const existing = await prisma.client.findUnique({ where: { id: clientId }, select: { webhookSecret: true } });
  if (!existing?.webhookSecret) data.webhookSecret = generateWebhookSecret();
  const c = await prisma.client.update({ where: { id: clientId }, data });
  return {
    url: c.webhookUrl, enabled: c.webhookEnabled, secret: c.webhookSecret,
    events: EVENT_LIST, catalog: EVENT_CATALOG.map(({ event, label }) => ({ event, label })),
    subscribedEvents: c.webhookEvents || [],
  };
}

export async function rotateSecret(clientId) {
  const secret = generateWebhookSecret();
  await prisma.client.update({ where: { id: clientId }, data: { webhookSecret: secret } });
  return { secret };
}

export async function listDeliveries(clientId, take = 50) {
  const rows = await prisma.webhookDelivery.findMany({ where: { clientId }, orderBy: { createdAt: 'desc' }, take });
  return serialize(rows);
}

// Send a signed test event to the client's configured endpoint. Optionally test
// a specific event with its realistic sample payload.
export async function sendTest(clientId, event) {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client?.webhookUrl) return { ok: false, error: 'Webhook URL не задан' };
  if (!client.webhookSecret) {
    client.webhookSecret = generateWebhookSecret();
    await prisma.client.update({ where: { id: clientId }, data: { webhookSecret: client.webhookSecret } });
  }
  if (event && EVENT_LIST.includes(event)) {
    return deliver(client, event, { test: true, ...(SAMPLES[event] || {}) });
  }
  return deliver(client, EVENTS.TEST, { message: 'Тестовое событие Love&Pay', ok: true });
}
