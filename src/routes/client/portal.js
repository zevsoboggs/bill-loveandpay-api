// Authenticated client-cabinet API (req.portalClient set by clientPortalAuth).
import { Router } from 'express';
import prisma from '../../db.js';
import cryptoOffice from '../../services/cryptoOffice.js';
import sbp from '../../services/sbp.js';
import promptpay from '../../services/promptpay.js';
import { checkClient } from '../../services/depositWatcher.js';
import { generateApiKey, generateApiSecret, normalizeIp } from '../../lib/apiKeys.js';
import { marginFor } from '../../lib/pricing.js';
import { minDepositFor } from '../../lib/deposits.js';
import { serialize, toNum } from '../../lib/money.js';
import { toCsv, txColumns } from '../../lib/csv.js';
import { generateStatement } from '../../lib/statement.js';
import { monthRange, collectStatement } from '../../lib/statementData.js';

const router = Router();

// GET /api/client/me — profile, balances, margins, deposit wallet
router.get('/me', async (req, res) => {
  const c = await prisma.client.findUnique({
    where: { id: req.portalClient.id },
    include: { ipWhitelist: true, _count: { select: { transactions: true, deposits: true } } },
  });
  res.json(serialize({
    id: c.id, name: c.name, email: c.email, company: c.company, status: c.status,
    avatarUrl: c.avatarUrl || null, vpnAutoRenew: c.vpnAutoRenew,
    balances: { deposit: toNum(c.depositBalance), sbp: toNum(c.sbpBalance), promptpay: toNum(c.promptpayBalance), esim: toNum(c.esimBalance), vpn: toNum(c.vpnBalance) },
    margins: { sbp: marginFor(c, 'SBP'), promptpay: marginFor(c, 'PROMPTPAY'), esim: marginFor(c, 'ESIM'), vpn: marginFor(c, 'VPN') },
    services: { sbp: c.sbpEnabled, promptpay: c.promptpayEnabled, esim: c.esimEnabled, vpn: c.vpnEnabled, transit: c.transitEnabled },
    api: { apiKey: c.apiKey, apiSecret: c.apiSecret, ipRestricted: c.ipRestricted, sandboxApiKey: c.sandboxApiKey, sandboxApiSecret: c.sandboxApiSecret },
    deposit: { walletAddress: c.depositWalletAddress, network: c.depositWalletAddress ? 'TRC-20' : null, hasWallet: !!c.depositWalletId, minDeposit: minDepositFor(c) },
    ipWhitelist: c.ipWhitelist,
    counts: c._count,
  }));
});

// PATCH /api/client/profile — update avatar / VPN auto-renew preference
router.patch('/profile', async (req, res) => {
  try {
    const { avatarUrl, vpnAutoRenew } = req.body || {};
    if (avatarUrl != null && String(avatarUrl).length > 500000) return res.status(400).json({ error: 'Аватар слишком большой (макс ~500 КБ)' });
    const data = {};
    if (avatarUrl !== undefined) data.avatarUrl = avatarUrl || null;
    if (vpnAutoRenew !== undefined) data.vpnAutoRenew = !!vpnAutoRenew;
    const c = await prisma.client.update({ where: { id: req.portalClient.id }, data });
    res.json({ avatarUrl: c.avatarUrl || null, vpnAutoRenew: c.vpnAutoRenew });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/client/rates — live SBP (USDT/RUB) & PromptPay (USDT/THB) rates for
// the partner's enabled services. Short timeout + graceful degradation.
const raceTimeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);
router.get('/rates', async (req, res) => {
  const c = req.portalClient;
  const out = {};
  const tasks = [];
  if (c.sbpEnabled) {
    tasks.push(raceTimeout(sbp.getRate(), 9000)
      .then((r) => { out.sbp = { rubPerUsdt: Number(r?.rate) || null, updatedAt: r?.updatedAt || null }; })
      .catch(() => { out.sbp = { error: true }; }));
  }
  if (c.promptpayEnabled) {
    tasks.push(raceTimeout(promptpay.getRate(), 9000)
      .then((r) => { out.promptpay = { thbPerUsdt: Number(r?.данные?.курс_usdt_thb) || null, updatedAt: r?.данные?.обновлено || null }; })
      .catch(() => { out.promptpay = { error: true }; }));
  }
  await Promise.all(tasks);
  res.json(out);
});

// GET /api/client/rate-history?system=SBP&days=14 — snapshots for the rate chart
router.get('/rate-history', async (req, res) => {
  try {
    const system = (req.query.system || 'SBP').toUpperCase();
    if (!['SBP', 'PROMPTPAY'].includes(system)) return res.status(400).json({ error: 'system must be SBP or PROMPTPAY' });
    const days = Math.min(parseInt(req.query.days || '14', 10) || 14, 90);
    const since = new Date(Date.now() - days * 86400 * 1000);
    const rows = await prisma.rateSnapshot.findMany({
      where: { system, at: { gte: since } }, orderBy: { at: 'asc' }, take: 5000,
    });
    res.json({ system, points: rows.map((r) => ({ at: r.at, rate: toNum(r.rate) })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/client/analytics?from=&to= — this partner's own spend analytics
router.get('/analytics', async (req, res) => {
  try {
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 30 * 86400 * 1000);
    const cid = req.portalClient.id;

    const rows = await prisma.$queryRaw`
      SELECT date_trunc('day', "createdAt") AS day, system, COUNT(*)::int AS count, COALESCE(SUM("chargedUsdt"),0) AS spent
      FROM transactions WHERE "clientId" = ${cid} AND status = 'COMPLETED' AND "createdAt" >= ${from} AND "createdAt" <= ${to}
      GROUP BY day, system ORDER BY day ASC`;
    const byDay = {};
    for (const r of rows) {
      const key = new Date(r.day).toISOString().slice(0, 10);
      byDay[key] ||= { day: key, SBP: 0, PROMPTPAY: 0, ESIM: 0, VPN: 0, spent: 0, count: 0 };
      byDay[key][r.system] = toNum(r.spent); byDay[key].spent += toNum(r.spent); byDay[key].count += r.count;
    }
    const bySystem = await prisma.transaction.groupBy({ by: ['system'], where: { clientId: cid, status: 'COMPLETED', createdAt: { gte: from, lte: to } }, _sum: { chargedUsdt: true }, _count: true });
    const totals = { spent: 0, count: 0, systems: {} };
    for (const s of bySystem) { totals.systems[s.system] = { spent: toNum(s._sum.chargedUsdt), count: s._count }; totals.spent += toNum(s._sum.chargedUsdt); totals.count += s._count; }
    res.json({ range: { from, to }, series: Object.values(byDay), totals });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/client/transactions/export — CSV of this partner's transactions
router.get('/transactions/export', async (req, res) => {
  try {
    const rows = await prisma.transaction.findMany({ where: { clientId: req.portalClient.id }, orderBy: { createdAt: 'desc' }, take: 50000 });
    const csv = toCsv(rows, txColumns);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="my_transactions_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/client/statement?month=YYYY-MM — monthly PDF statement (no profit)
router.get('/statement', async (req, res) => {
  try {
    const { from, to, monthLabel } = monthRange(req.query.month);
    const data = await collectStatement(req.portalClient, from, to);
    const pdf = await generateStatement(req.portalClient, { ...data, monthLabel, includeProfit: false });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="statement_${req.query.month || 'current'}.pdf"`);
    res.send(pdf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/client/api-logs — this partner's own API request log
router.get('/api-logs', async (req, res) => {
  const take = Math.min(parseInt(req.query.limit || '100', 10) || 100, 500);
  const rows = await prisma.apiRequestLog.findMany({ where: { clientId: req.portalClient.id }, orderBy: { createdAt: 'desc' }, take });
  res.json(serialize(rows));
});

// GET /api/client/deposits
router.get('/deposits', async (req, res) => {
  const rows = await prisma.deposit.findMany({ where: { clientId: req.portalClient.id }, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json(serialize(rows));
});

// POST /api/client/deposits/check — trigger an immediate wallet poll for self
router.post('/deposits/check', async (req, res) => {
  try {
    if (!req.portalClient.depositWalletId) return res.status(400).json({ error: 'Депозитный кошелёк не создан. Обратитесь к администратору.' });
    const result = await checkClient(req.portalClient.id);
    res.json({ ok: true, credited: result?.credited || 0, onchainUsdt: result?.newBalance ?? null });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// GET /api/client/transactions?system=SBP|PROMPTPAY
router.get('/transactions', async (req, res) => {
  const where = { clientId: req.portalClient.id };
  if (req.query.system && ['SBP', 'PROMPTPAY'].includes(req.query.system)) where.system = req.query.system;
  const rows = await prisma.transaction.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json(serialize(rows.map((t) => ({
    id: t.id, system: t.system, status: t.status,
    sourceAmount: t.sourceAmount, sourceCurrency: t.sourceCurrency,
    chargedUsdt: t.chargedUsdt, providerRef: t.providerRef, description: t.description, createdAt: t.createdAt,
  }))));
});

// GET /api/client/ledger
router.get('/ledger', async (req, res) => {
  const rows = await prisma.ledgerEntry.findMany({ where: { clientId: req.portalClient.id }, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json(serialize(rows));
});

// ── IP whitelist (self-service) ──────────────────────────────────────────────
router.get('/ip-whitelist', async (req, res) => {
  const rows = await prisma.ipWhitelist.findMany({ where: { clientId: req.portalClient.id }, orderBy: { createdAt: 'desc' } });
  res.json(serialize(rows));
});

router.post('/ip-whitelist', async (req, res) => {
  try {
    const { ip, label } = req.body || {};
    if (!ip) return res.status(400).json({ error: 'ip обязателен' });
    const row = await prisma.ipWhitelist.create({ data: { clientId: req.portalClient.id, ip: normalizeIp(String(ip)), label: label || null } });
    res.status(201).json(serialize(row));
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'Этот IP уже добавлен' });
    res.status(500).json({ error: e.message });
  }
});

router.delete('/ip-whitelist/:id', async (req, res) => {
  const row = await prisma.ipWhitelist.findUnique({ where: { id: req.params.id } });
  if (!row || row.clientId !== req.portalClient.id) return res.status(404).json({ error: 'Not found' });
  await prisma.ipWhitelist.delete({ where: { id: req.params.id } });
  res.json({ id: req.params.id });
});

// ── Card program applications (self-service) ─────────────────────────────────
router.get('/card-applications', async (req, res) => {
  const rows = await prisma.cardApplication.findMany({ where: { clientId: req.portalClient.id }, orderBy: { createdAt: 'desc' } });
  res.json(serialize(rows));
});

router.post('/card-applications', async (req, res) => {
  try {
    const { contact, contactName, cardType, volume, comment } = req.body || {};
    if (!contact) return res.status(400).json({ error: 'Укажите контакт для связи' });
    const row = await prisma.cardApplication.create({
      data: {
        clientId: req.portalClient.id,
        contact: String(contact).slice(0, 200),
        contactName: contactName || req.portalClient.name,
        cardType: cardType || null, volume: volume || null, comment: comment || null,
      },
    });
    res.status(201).json(serialize(row));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/client/rotate-keys — regenerate own API credentials
router.post('/rotate-keys', async (req, res) => {
  const c = await prisma.client.update({
    where: { id: req.portalClient.id },
    data: { apiKey: generateApiKey(), apiSecret: generateApiSecret() },
    select: { apiKey: true, apiSecret: true },
  });
  res.json(serialize(c));
});

export default router;
