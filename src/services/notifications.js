// In-app cabinet notifications (the bell). Fire-and-forget.
import prisma from '../db.js';

export function notify(clientId, type, title, body = null, data = null) {
  if (!clientId) return;
  prisma.notification
    .create({ data: { clientId, type, title, body, data } })
    .catch((e) => console.error('[notify]', e.message));
}
