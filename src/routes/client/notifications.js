// In-app notifications for the cabinet bell.
import { Router } from 'express';
import prisma from '../../db.js';
import { serialize } from '../../lib/money.js';

const router = Router();

// GET /api/client/notifications?limit=&unread=1 — list + unread count
router.get('/', async (req, res) => {
  const cid = req.portalClient.id;
  const take = Math.min(parseInt(req.query.limit || '30', 10) || 30, 100);
  const where = { clientId: cid };
  if (req.query.unread === '1') where.read = false;
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take }),
    prisma.notification.count({ where: { clientId: cid, read: false } }),
  ]);
  res.json({ items: serialize(rows), unread });
});

// GET /api/client/notifications/unread-count — light poll for the badge
router.get('/unread-count', async (req, res) => {
  const unread = await prisma.notification.count({ where: { clientId: req.portalClient.id, read: false } });
  res.json({ unread });
});

// POST /api/client/notifications/read — mark one or all read
router.post('/read', async (req, res) => {
  const cid = req.portalClient.id;
  const { id } = req.body || {};
  if (id) {
    await prisma.notification.updateMany({ where: { id, clientId: cid }, data: { read: true } });
  } else {
    await prisma.notification.updateMany({ where: { clientId: cid, read: false }, data: { read: true } });
  }
  const unread = await prisma.notification.count({ where: { clientId: cid, read: false } });
  res.json({ ok: true, unread });
});

export default router;
