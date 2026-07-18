import { Router } from 'express';
import prisma from '../../db.js';
import { parseList, sendList } from '../../lib/refine.js';
import { serialize } from '../../lib/money.js';

const router = Router();

// GET /api/admin/ledger — immutable audit trail (read-only)
router.get('/', async (req, res) => {
  try {
    const { skip, take, orderBy, where } = parseList(req.query, {
      allowedFilters: ['clientId', 'kind', 'balanceType', 'system'],
    });
    const [rows, total] = await Promise.all([
      prisma.ledgerEntry.findMany({ skip, take, orderBy, where, include: { client: { select: { name: true } } } }),
      prisma.ledgerEntry.count({ where }),
    ]);
    sendList(res, serialize(rows), total);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
