// Admin-only: collect (sweep) the physical USDT sitting on clients' on-chain
// deposit wallets to a destination WE choose. This does NOT change any client's
// depositBalance (their spendable API credit) — it only moves the real funds and
// keeps the deposit-watcher baseline consistent so future deposits still credit.
import { Router } from 'express';
import prisma from '../../db.js';
import cryptoOffice from '../../services/cryptoOffice.js';
import { checkClient } from '../../services/depositWatcher.js';
import { serialize, toNum, round6 } from '../../lib/money.js';

const router = Router();

const DUST = 0.5; // ignore sweeps below this (USDT)
const isTronAddress = (a) => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(String(a || '').trim());

// GET /api/admin/deposit-wallets?live=1 — clients with a deposit wallet + balances
router.get('/', async (req, res) => {
  try {
    const rows = await prisma.client.findMany({
      where: { depositWalletId: { not: null } },
      select: { id: true, name: true, depositWalletId: true, depositWalletAddress: true, depositWalletBaseline: true, depositBalance: true, status: true },
      orderBy: { name: 'asc' },
    });

    // Live on-chain USDT per wallet (best-effort, parallel). Skip with live=0.
    let onchain = {};
    if (req.query.live !== '0') {
      const results = await Promise.all(rows.map((r) =>
        cryptoOffice.getWalletUsdt(r.depositWalletId).then((v) => [r.id, v]).catch(() => [r.id, null])));
      onchain = Object.fromEntries(results);
    }

    res.json(serialize(rows.map((r) => ({
      clientId: r.id, name: r.name, status: r.status,
      walletId: r.depositWalletId, address: r.depositWalletAddress,
      baseline: toNum(r.depositWalletBaseline), depositBalance: toNum(r.depositBalance),
      onchainUsdt: onchain[r.id] ?? null,
    }))));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/deposit-wallets/sweeps — recent collection history
router.get('/sweeps', async (req, res) => {
  const take = Math.min(parseInt(req.query.limit || '100', 10) || 100, 500);
  const rows = await prisma.depositSweep.findMany({ orderBy: { createdAt: 'desc' }, take, include: { client: { select: { name: true } } } });
  res.json(serialize(rows));
});

// GET /api/admin/deposit-wallets/:clientId/balance — refresh one wallet's balance
router.get('/:clientId/balance', async (req, res) => {
  try {
    const c = await prisma.client.findUnique({ where: { id: req.params.clientId }, select: { depositWalletId: true } });
    if (!c?.depositWalletId) return res.status(404).json({ error: 'У клиента нет депозитного кошелька' });
    const onchainUsdt = await cryptoOffice.getWalletUsdt(c.depositWalletId);
    res.json({ onchainUsdt });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// POST /api/admin/deposit-wallets/:clientId/sweep — collect USDT to our address.
// body: { toAddress, amount? }  (amount omitted = full balance)
router.post('/:clientId/sweep', async (req, res) => {
  try {
    const { toAddress, amount, note } = req.body || {};
    const dest = String(toAddress || '').trim();
    if (!isTronAddress(dest)) return res.status(400).json({ error: 'Укажите корректный TRON-адрес получателя (T…)', code: 'BAD_ADDRESS' });

    const client = await prisma.client.findUnique({ where: { id: req.params.clientId } });
    if (!client?.depositWalletId) return res.status(404).json({ error: 'У клиента нет депозитного кошелька' });

    // 1) Credit any pending arrival first so we never sweep uncredited funds; this
    //    also advances the baseline to the current on-chain level.
    try { await checkClient(client.id); } catch { /* non-fatal */ }
    const fresh = await prisma.client.findUnique({ where: { id: client.id } });

    // 2) Current on-chain USDT.
    const onchain = await cryptoOffice.getWalletUsdt(client.depositWalletId);
    const want = amount != null ? round6(Number(amount)) : round6(onchain);
    if (!(want > 0)) return res.status(400).json({ error: 'Сумма должна быть больше 0' });
    if (want < DUST) return res.status(400).json({ error: `Минимум к выводу — ${DUST} USDT`, code: 'BELOW_DUST' });
    if (want > round6(onchain) + 1e-6) return res.status(400).json({ error: `На кошельке только ${onchain} USDT`, code: 'INSUFFICIENT', onchainUsdt: onchain });

    // 3) Send USDT (send_coin 1 = USDT TRC-20) to the chosen address.
    let result;
    try {
      result = await cryptoOffice.sendMoney(client.depositWalletId, 1, dest, want);
    } catch (e) {
      const msg = String(e.response?.data?.message || e.response?.data?.error || e.message || '').toLowerCase();
      const sweep = await prisma.depositSweep.create({
        data: { clientId: client.id, walletId: client.depositWalletId, toAddress: dest, amountUsdt: want, status: 'FAILED', error: msg.slice(0, 300), adminId: req.admin?.sub || null, note: note || null },
      });
      if (/trx|energy|bandwidth|fee/.test(msg)) return res.status(502).json({ error: 'Недостаточно TRX на кошельке для комиссии сети. Пополните энергией/TRX и повторите.', code: 'TRX_FEE', sweepId: sweep.id });
      if (/insufficient|balance/.test(msg)) return res.status(400).json({ error: 'Недостаточно средств на кошельке', code: 'INSUFFICIENT' });
      return res.status(502).json({ error: 'Перевод не прошёл: ' + (e.response?.data?.message || e.message), sweepId: sweep.id });
    }

    // 4) Success — lower the watcher baseline by the swept amount so future
    //    arrivals credit correctly and in-flight deposits aren't lost.
    const newBaseline = Math.max(0, round6(toNum(fresh.depositWalletBaseline) - want));
    await prisma.client.update({ where: { id: client.id }, data: { depositWalletBaseline: newBaseline } });
    const txRef = result?.data?.tx_hash || result?.tx_hash || result?.data?.hash || result?.hash || null;
    const sweep = await prisma.depositSweep.create({
      data: { clientId: client.id, walletId: client.depositWalletId, toAddress: dest, amountUsdt: want, status: 'SENT', txRef: txRef ? String(txRef) : null, adminId: req.admin?.sub || null, note: note || null },
    });

    res.json(serialize({ success: true, sweepId: sweep.id, amountUsdt: want, toAddress: dest, txRef, remainingOnchain: round6(onchain - want) }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
