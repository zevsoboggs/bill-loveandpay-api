import { Router } from 'express';
import prisma from '../../db.js';
import { parseList, sendList } from '../../lib/refine.js';
import { serialize } from '../../lib/money.js';

const router = Router();

// GET /api/admin/card-applications
router.get('/', async (req, res) => {
  try {
    const { skip, take, orderBy, where } = parseList(req.query, { allowedFilters: ['clientId', 'status'] });
    const [rows, total] = await Promise.all([
      prisma.cardApplication.findMany({ skip, take, orderBy, where, include: { client: { select: { name: true, email: true } } } }),
      prisma.cardApplication.count({ where }),
    ]);
    sendList(res, serialize(rows), total);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', async (req, res) => {
  const row = await prisma.cardApplication.findUnique({ where: { id: req.params.id }, include: { client: { select: { name: true, email: true } } } });
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(serialize(row));
});

// PATCH /api/admin/card-applications/:id — update status / admin note
router.patch('/:id', async (req, res) => {
  try {
    const { status, adminNote } = req.body || {};
    const data = {};
    if (status !== undefined) data.status = status;
    if (adminNote !== undefined) data.adminNote = adminNote;
    const row = await prisma.cardApplication.update({ where: { id: req.params.id }, data });
    res.json(serialize(row));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
