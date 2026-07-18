import { Router } from 'express';
import prisma from '../../db.js';
import { parseList, sendList } from '../../lib/refine.js';
import { serialize } from '../../lib/money.js';

const router = Router();

// GET /api/admin/esims — issued eSIMs across all clients (read-only)
router.get('/', async (req, res) => {
  try {
    const { skip, take, orderBy, where } = parseList(req.query, { allowedFilters: ['clientId', 'status', 'country'] });
    const [rows, total] = await Promise.all([
      prisma.esim.findMany({ skip, take, orderBy, where, include: { client: { select: { name: true } } } }),
      prisma.esim.count({ where }),
    ]);
    sendList(res, serialize(rows), total);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', async (req, res) => {
  const row = await prisma.esim.findUnique({ where: { id: req.params.id }, include: { client: { select: { name: true } } } });
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(serialize(row));
});

export default router;
