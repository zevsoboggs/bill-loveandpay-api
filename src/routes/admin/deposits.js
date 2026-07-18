import { Router } from 'express';
import prisma from '../../db.js';
import { parseList, sendList } from '../../lib/refine.js';
import { serialize } from '../../lib/money.js';
import { creditDeposit } from '../../lib/ledger.js';

const router = Router();

// GET /api/admin/deposits
router.get('/', async (req, res) => {
  try {
    const { skip, take, orderBy, where } = parseList(req.query, {
      allowedFilters: ['clientId', 'status', 'network'],
    });
    const [rows, total] = await Promise.all([
      prisma.deposit.findMany({ skip, take, orderBy, where, include: { client: { select: { name: true } } } }),
      prisma.deposit.count({ where }),
    ]);
    sendList(res, serialize(rows), total);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', async (req, res) => {
  const row = await prisma.deposit.findUnique({ where: { id: req.params.id }, include: { client: { select: { name: true } } } });
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(serialize(row));
});

// POST /api/admin/deposits — record a USDT deposit. If status CREDITED, it is
// immediately credited to the client's deposit pool (with a ledger entry).
router.post('/', async (req, res) => {
  try {
    const { clientId, amountUsdt, network, txHash, address, status, note } = req.body || {};
    if (!clientId || !amountUsdt || Number(amountUsdt) <= 0) {
      return res.status(400).json({ error: 'clientId и положительный amountUsdt обязательны' });
    }
    const finalStatus = status || 'CREDITED';
    const deposit = await prisma.deposit.create({
      data: {
        clientId, amountUsdt: Number(amountUsdt), network: network || 'TRC-20',
        txHash: txHash || null, address: address || null, status: finalStatus, note: note || null,
        confirmedAt: finalStatus === 'CREDITED' || finalStatus === 'CONFIRMED' ? new Date() : null,
      },
    });
    if (finalStatus === 'CREDITED') {
      await creditDeposit(clientId, Number(amountUsdt), { refId: deposit.id, note: note || 'Manual deposit' });
    }
    res.status(201).json(serialize(deposit));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/admin/deposits/:id — status transitions; crediting on → CREDITED
router.patch('/:id', async (req, res) => {
  try {
    const existing = await prisma.deposit.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const { status, note } = req.body || {};
    const data = {};
    if (note !== undefined) data.note = note;
    if (status !== undefined) {
      data.status = status;
      if ((status === 'CREDITED' || status === 'CONFIRMED') && !existing.confirmedAt) data.confirmedAt = new Date();
    }
    const updated = await prisma.deposit.update({ where: { id: req.params.id }, data });

    // Credit only on the PENDING/CONFIRMED → CREDITED transition (never double-credit).
    if (status === 'CREDITED' && existing.status !== 'CREDITED') {
      await creditDeposit(existing.clientId, Number(existing.amountUsdt), { refId: existing.id, note: 'Deposit credited' });
    }
    res.json(serialize(updated));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
