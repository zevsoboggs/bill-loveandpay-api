import { Router } from 'express';
import prisma from '../../db.js';
import { parseList, sendList } from '../../lib/refine.js';
import { serialize } from '../../lib/money.js';
import aml from '../../services/aml.js';

const router = Router();

// GET /api/admin/aml-checks — AML checks across all clients (read-only)
router.get('/', async (req, res) => {
  try {
    const { skip, take, orderBy, where } = parseList(req.query, { allowedFilters: ['clientId', 'network', 'riskLevel', 'verdict'] });
    const [rows, total] = await Promise.all([
      prisma.amlCheck.findMany({ skip, take, orderBy, where, include: { client: { select: { name: true } } } }),
      prisma.amlCheck.count({ where }),
    ]);
    sendList(res, serialize(rows), total);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/aml-checks/provider-quota — remaining checks on our provider key
router.get('/provider-quota', async (req, res) => {
  try { res.json(await aml.providerQuota()); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

router.get('/:id', async (req, res) => {
  const row = await prisma.amlCheck.findUnique({ where: { id: req.params.id }, include: { client: { select: { name: true } } } });
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(serialize(row));
});

export default router;
