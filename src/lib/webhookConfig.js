// Shared webhook-config handlers, used by both the cabinet and the relay API.
import prisma from '../db.js';
import { generateWebhookSecret } from './apiKeys.js';
import { deliver, EVENTS } from '../services/webhooks.js';
import { serialize } from './money.js';

const EVENT_LIST = Object.values(EVENTS);

export async function getConfig(client) {
  // Ensure a secret exists so the client can verify signatures.
  let secret = client.webhookSecret;
  if (!secret) {
    secret = generateWebhookSecret();
    await prisma.client.update({ where: { id: client.id }, data: { webhookSecret: secret } });
  }
  return { url: client.webhookUrl || null, enabled: client.webhookEnabled, secret, events: EVENT_LIST };
}

export async function updateConfig(clientId, { url, enabled }) {
  const data = {};
  if (url !== undefined) data.webhookUrl = url ? String(url).trim() : null;
  if (enabled !== undefined) data.webhookEnabled = !!enabled;
  // Auto-generate a secret on first configuration.
  const existing = await prisma.client.findUnique({ where: { id: clientId }, select: { webhookSecret: true } });
  if (!existing?.webhookSecret) data.webhookSecret = generateWebhookSecret();
  const c = await prisma.client.update({ where: { id: clientId }, data });
  return { url: c.webhookUrl, enabled: c.webhookEnabled, secret: c.webhookSecret, events: EVENT_LIST };
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

// Send a signed test event to the client's configured endpoint.
export async function sendTest(clientId) {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client?.webhookUrl) return { ok: false, error: 'Webhook URL не задан' };
  if (!client.webhookSecret) {
    client.webhookSecret = generateWebhookSecret();
    await prisma.client.update({ where: { id: clientId }, data: { webhookSecret: client.webhookSecret } });
  }
  return deliver(client, EVENTS.TEST, { message: 'Тестовое событие Love&Pay', ok: true });
}
