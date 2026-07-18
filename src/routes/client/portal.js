// Authenticated client-cabinet API (req.portalClient set by clientPortalAuth).
import { Router } from 'express';
import prisma from '../../db.js';
import cryptoOffice from '../../services/cryptoOffice.js';
import { checkClient } from '../../services/depositWatcher.js';
import { generateApiKey, generateApiSecret, normalizeIp } from '../../lib/apiKeys.js';
import { marginFor } from '../../lib/pricing.js';
import { serialize, toNum } from '../../lib/money.js';

const router = Router();

// GET /api/client/me — profile, balances, margins, deposit wallet
router.get('/me', async (req, res) => {
  const c = await prisma.client.findUnique({
    where: { id: req.portalClient.id },
    include: { ipWhitelist: true, _count: { select: { transactions: true, deposits: true } } },
  });
  res.json(serialize({
    id: c.id, name: c.name, email: c.email, company: c.company, status: c.status,
    balances: { deposit: toNum(c.depositBalance), sbp: toNum(c.sbpBalance), promptpay: toNum(c.promptpayBalance) },
    margins: { sbp: marginFor(c, 'SBP'), promptpay: marginFor(c, 'PROMPTPAY') },
    api: { apiKey: c.apiKey, apiSecret: c.apiSecret, ipRestricted: c.ipRestricted },
    deposit: { walletAddress: c.depositWalletAddress, network: c.depositWalletAddress ? 'TRC-20' : null, hasWallet: !!c.depositWalletId },
    ipWhitelist: c.ipWhitelist,
    counts: c._count,
  }));
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
