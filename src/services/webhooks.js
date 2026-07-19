// Outbound webhooks: signed, retried, logged event delivery to partner endpoints.
import crypto from 'crypto';
import axios from 'axios';
import prisma from '../db.js';

// Catalogue of emitted events (documented in Swagger).
export const EVENTS = {
  TEST: 'webhook.test',
  DEPOSIT_CREDITED: 'deposit.credited',
  PAYMENT_COMPLETED: 'payment.completed',
  PAYMENT_FAILED: 'payment.failed',
  ESIM_ISSUED: 'esim.issued',
  VPN_ISSUED: 'vpn.issued',
};

// HMAC-SHA256 signature of the raw JSON body.
export function sign(secret, body) {
  return 'sha256=' + crypto.createHmac('sha256', secret || '').update(body).digest('hex');
}

function eventId() {
  return 'evt_' + crypto.randomBytes(16).toString('hex');
}

// Deliver a single event to a client's endpoint with retries; logs the attempt.
// Returns { ok, httpStatus, error }. Never throws.
export async function deliver(client, event, data) {
  if (!client?.webhookUrl) return { ok: false, error: 'no_url' };

  const body = JSON.stringify({ id: eventId(), event, created: new Date().toISOString(), data });
  const signature = sign(client.webhookSecret, body);
  const headers = {
    'Content-Type': 'application/json',
    'X-LnP-Event': event,
    'X-LnP-Signature': signature,
    'User-Agent': 'LoveAndPay-Webhooks/1.0',
  };

  const log = await prisma.webhookDelivery.create({
    data: { clientId: client.id, event, url: client.webhookUrl, payload: JSON.parse(body), status: 'PENDING' },
  });

  let lastErr = null;
  let httpStatus = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await axios.post(client.webhookUrl, body, { headers, timeout: 10000, validateStatus: () => true });
      httpStatus = resp.status;
      if (resp.status >= 200 && resp.status < 300) {
        await prisma.webhookDelivery.update({ where: { id: log.id }, data: { status: 'SUCCESS', httpStatus, attempts: attempt, deliveredAt: new Date() } });
        return { ok: true, httpStatus, deliveryId: log.id };
      }
      lastErr = `HTTP ${resp.status}`;
    } catch (e) {
      lastErr = e.message;
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1000));
  }

  await prisma.webhookDelivery.update({ where: { id: log.id }, data: { status: 'FAILED', httpStatus, attempts: 3, error: String(lastErr).slice(0, 300) } });
  return { ok: false, httpStatus, error: lastErr, deliveryId: log.id };
}

// Fire-and-forget dispatch by clientId — used from payment/deposit flows.
// Honours the client's event subscription: an empty webhookEvents list means
// "all events" (backward-compatible); otherwise only subscribed events fire.
export function dispatch(clientId, event, data) {
  prisma.client
    .findUnique({ where: { id: clientId } })
    .then((client) => {
      if (!client?.webhookEnabled || !client?.webhookUrl) return;
      const subs = client.webhookEvents || [];
      if (subs.length && !subs.includes(event)) return;
      return deliver(client, event, data);
    })
    .catch((e) => console.error('[webhooks] dispatch error:', e.message));
}
