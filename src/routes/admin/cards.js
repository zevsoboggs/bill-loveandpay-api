// Admin-only corporate crypto cards (PaySpace VCC). Issue cards from our float to
// pay platform expenses (hosting, subscriptions), top them up, and view spend.
// PAN/CVV are never stored — fetched live from the provider on demand.
import { Router } from 'express';
import crypto from 'crypto';
import prisma from '../../db.js';
import config from '../../config.js';
import * as payspace from '../../services/payspace.js';
import { parseList, sendList } from '../../lib/refine.js';
import { serialize } from '../../lib/money.js';

const router = Router();

const maskFrom = (cardNo) => {
  const digits = String(cardNo || '').replace(/\s+/g, '');
  if (digits.length < 8) return { maskedNumber: null, last4: digits.slice(-4) || null };
  return { maskedNumber: `${digits.slice(0, 6)} ${'••'} •••• ${digits.slice(-4)}`, last4: digits.slice(-4) };
};

// GET /api/admin/corporate-cards/programs — issuable programs
router.get('/programs', (req, res) => {
  res.json(config.payspace.programs.filter((p) => p.enabled));
});

// GET /api/admin/corporate-cards/account — our PaySpace float (available to issue/topup)
router.get('/account', async (req, res) => {
  try {
    const r = await payspace.getBalance();
    res.json(r?.data || r);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// GET /api/admin/corporate-cards — issued cards (stored)
router.get('/', async (req, res) => {
  try {
    const { skip, take, orderBy, where } = parseList(req.query, { allowedFilters: ['status', 'programCode', 'label'] });
    const [rows, total] = await Promise.all([
      prisma.corporateCard.findMany({ skip, take, orderBy, where }),
      prisma.corporateCard.count({ where }),
    ]);
    sendList(res, serialize(rows), total);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/corporate-cards/:id — stored card
router.get('/:id', async (req, res) => {
  const row = await prisma.corporateCard.findUnique({ where: { id: req.params.id }, include: { topups: { orderBy: { createdAt: 'desc' }, take: 100 } } });
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(serialize(row));
});

// GET /api/admin/corporate-cards/:id/reveal — live PAN/CVV/expiry from provider
router.get('/:id/reveal', async (req, res) => {
  try {
    const card = await prisma.corporateCard.findUnique({ where: { id: req.params.id } });
    if (!card) return res.status(404).json({ error: 'Not found' });
    const info = await payspace.getCardInfo(card.providerCardId);
    const d = info?.data || {};
    res.json({ cardNo: d.cardNo || d.card_no || null, cvv: d.cvv || null, expDate: d.expDate || d.exp_date || null, cardType: d.cardType || d.card_type || null, balanceUsd: Number(d.cardBal ?? d.card_bal ?? 0) });
  } catch (e) { res.status(502).json({ error: 'Не удалось получить данные карты: ' + e.message }); }
});

// GET /api/admin/corporate-cards/:id/transactions — live spend from provider
router.get('/:id/transactions', async (req, res) => {
  try {
    const card = await prisma.corporateCard.findUnique({ where: { id: req.params.id } });
    if (!card) return res.status(404).json({ error: 'Not found' });
    const r = await payspace.getCardTransactions(card.providerCardId, Math.min(parseInt(req.query.limit || '50', 10) || 50, 200), parseInt(req.query.offset || '0', 10) || 0);
    res.json(r?.data ?? r);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// POST /api/admin/corporate-cards/:id/sync — refresh stored balance/status
router.post('/:id/sync', async (req, res) => {
  try {
    const card = await prisma.corporateCard.findUnique({ where: { id: req.params.id } });
    if (!card) return res.status(404).json({ error: 'Not found' });
    const info = await payspace.getCardInfo(card.providerCardId);
    const d = info?.data || {};
    const bal = Number(d.cardBal ?? d.card_bal ?? card.balanceUsd);
    const { maskedNumber, last4 } = maskFrom(d.cardNo || d.card_no);
    const updated = await prisma.corporateCard.update({
      where: { id: card.id },
      data: {
        balanceUsd: bal, status: (d.status || card.status || 'active'),
        maskedNumber: maskedNumber || card.maskedNumber, last4: last4 || card.last4,
        expDate: d.expDate || d.exp_date || card.expDate, cardType: d.cardType || d.card_type || card.cardType,
        lastSyncedAt: new Date(),
      },
    });
    res.json(serialize(updated));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// POST /api/admin/corporate-cards — issue a new card (SPENDS from our float).
// body: { programCode, initialAmount?, label?, email? }
router.post('/', async (req, res) => {
  try {
    const { programCode, initialAmount, label, email } = req.body || {};
    const program = config.payspace.programs.find((p) => p.code === programCode && p.enabled);
    if (!program) return res.status(400).json({ error: 'Неизвестная или отключённая программа карты' });
    const load = Math.max(0, Number(initialAmount) || 0);

    const callbackUrl = config.payspace.callbackBaseUrl ? `${config.payspace.callbackBaseUrl}/api/webhooks/payspace/card` : '';
    let result;
    try {
      result = await payspace.createCard(load || 1, programCode, callbackUrl);
    } catch (e) {
      return res.status(502).json({ error: 'Провайдер отклонил выпуск: ' + e.message });
    }
    const cardData = result?.data?.card || result?.data || {};
    const providerCardId = cardData.card_id || cardData.cardId;
    if (!providerCardId) return res.status(502).json({ error: 'Провайдер не вернул card_id', raw: result });

    // Full info (mask only — never store PAN/CVV).
    let info = {};
    try { const r = await payspace.getCardInfo(providerCardId); info = r?.data || {}; } catch { /* non-fatal */ }
    if (email) { try { await payspace.updateCardEmail(providerCardId, email); } catch { /* non-fatal */ } }

    const { maskedNumber, last4 } = maskFrom(info.cardNo || info.card_no || cardData.card_no);
    const card = await prisma.corporateCard.create({
      data: {
        providerCardId: String(providerCardId), programCode, title: program.title,
        label: label || null, maskedNumber, last4,
        expDate: info.expDate || info.exp_date || null, cardType: info.cardType || info.card_type || null,
        status: (info.status || 'active'), balanceUsd: Number(info.cardBal ?? info.card_bal ?? load) || 0,
        email: email || null, createdByAdminId: req.admin?.sub || null, lastSyncedAt: new Date(),
      },
    });
    await prisma.cardTopup.create({ data: { cardId: card.id, kind: 'issue', amountUsd: load, adminId: req.admin?.sub || null, note: `Выпуск ${program.title}` } });

    res.status(201).json(serialize(card));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/corporate-cards/:id/topup — top up a card (SPENDS from our float).
// body: { amount }
router.post('/:id/topup', async (req, res) => {
  try {
    const card = await prisma.corporateCard.findUnique({ where: { id: req.params.id } });
    if (!card) return res.status(404).json({ error: 'Not found' });
    const amount = Number(req.body?.amount);
    if (!(amount > 0)) return res.status(400).json({ error: 'Сумма пополнения должна быть больше 0' });

    const requestId = 'lnp_' + crypto.randomBytes(10).toString('hex');
    let result;
    try {
      result = await payspace.topupCard(card.providerCardId, amount, requestId);
    } catch (e) {
      return res.status(502).json({ error: 'Пополнение не прошло: ' + e.message });
    }

    // Refresh balance from provider (best-effort).
    let bal = Number(card.balanceUsd) + amount;
    try { const info = await payspace.getCardInfo(card.providerCardId); bal = Number(info?.data?.cardBal ?? info?.data?.card_bal ?? bal); } catch { /* keep optimistic */ }

    const updated = await prisma.corporateCard.update({ where: { id: card.id }, data: { balanceUsd: bal, lastSyncedAt: new Date() } });
    await prisma.cardTopup.create({ data: { cardId: card.id, kind: 'topup', amountUsd: amount, requestId, adminId: req.admin?.sub || null } });

    res.json(serialize({ ...updated, providerResult: result?.data || result }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
