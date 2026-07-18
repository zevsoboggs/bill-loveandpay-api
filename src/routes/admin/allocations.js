import { Router } from 'express';
import prisma from '../../db.js';
import { parseList, sendList } from '../../lib/refine.js';
import { serialize } from '../../lib/money.js';
import { allocate } from '../../lib/ledger.js';

const router = Router();

// GET /api/admin/allocations
router.get('/', async (req, res) => {
  try {
    const { skip, take, orderBy, where } = parseList(req.query, {
      allowedFilters: ['clientId', 'system'],
    });
    const [rows, total] = await Promise.all([
      prisma.allocation.findMany({
        skip, take, orderBy, where,
        include: { client: { select: { name: true } }, admin: { select: { email: true } } },
      }),
      prisma.allocation.count({ where }),
    ]);
    sendList(res, serialize(rows), total);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/allocations — distribute deposit → system (amount>0) or claw
// back system → deposit (amount<0). Atomic; writes ledger legs.
//   body: { clientId, system: 'SBP'|'PROMPTPAY', amount, note }
router.post('/', async (req, res) => {
  try {
    const { clientId, system, amount, note } = req.body || {};
    if (!clientId || !system || amount === undefined || Number(amount) === 0) {
      return res.status(400).json({ error: 'clientId, system и ненулевой amount обязательны' });
    }
    if (!['SBP', 'PROMPTPAY'].includes(system)) return res.status(400).json({ error: 'system must be SBP or PROMPTPAY' });

    const { allocation, client } = await allocate(clientId, req.admin?.sub || null, system, Number(amount), note || null);
    res.status(201).json(serialize({ ...allocation, client: { name: client.name }, balances: {
      depositBalance: client.depositBalance, sbpBalance: client.sbpBalance, promptpayBalance: client.promptpayBalance,
    } }));
  } catch (e) {
    if (e.code === 'INSUFFICIENT_DEPOSIT') return res.status(400).json({ error: 'Недостаточно средств на депозите', code: e.code });
    if (e.code === 'INSUFFICIENT_SYSTEM') return res.status(400).json({ error: 'Недостаточно средств в системе для возврата', code: e.code });
    res.status(500).json({ error: e.message });
  }
});

export default router;
