import { Router } from 'express';
import prisma from '../../db.js';
import { parseList, sendList } from '../../lib/refine.js';
import { serialize } from '../../lib/money.js';
import { toCsv, txColumns } from '../../lib/csv.js';

const router = Router();

// GET /api/admin/transactions/export?system=&status=&clientId=&from=&to= — CSV
router.get('/export', async (req, res) => {
  try {
    const where = {};
    for (const f of ['system', 'status', 'clientId']) if (req.query[f]) where[f] = req.query[f];
    if (req.query.from || req.query.to) {
      where.createdAt = {};
      if (req.query.from) where.createdAt.gte = new Date(req.query.from);
      if (req.query.to) where.createdAt.lte = new Date(req.query.to);
    }
    const rows = await prisma.transaction.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50000 });
    const csv = toCsv(rows, txColumns);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="transactions_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/transactions — read-only; filter by system/status/clientId
router.get('/', async (req, res) => {
  try {
    const { skip, take, orderBy, where } = parseList(req.query, {
      allowedFilters: ['clientId', 'system', 'status'],
    });
    const [rows, total] = await Promise.all([
      prisma.transaction.findMany({ skip, take, orderBy, where, include: { client: { select: { name: true } } } }),
      prisma.transaction.count({ where }),
    ]);
    sendList(res, serialize(rows), total);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', async (req, res) => {
  const row = await prisma.transaction.findUnique({ where: { id: req.params.id }, include: { client: { select: { name: true } } } });
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(serialize(row));
});

export default router;
