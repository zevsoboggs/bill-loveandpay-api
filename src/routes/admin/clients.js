import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../../db.js';
import { parseList, sendList } from '../../lib/refine.js';
import { serialize } from '../../lib/money.js';
import { generateApiKey, generateApiSecret } from '../../lib/apiKeys.js';
import { adjustBalance } from '../../lib/ledger.js';
import { generateStatement } from '../../lib/statement.js';
import { monthRange, collectStatement } from '../../lib/statementData.js';
import cryptoOffice from '../../services/cryptoOffice.js';

const router = Router();

const publicSelect = {
  id: true, name: true, email: true, company: true, status: true,
  apiKey: true, apiSecret: true, ipRestricted: true,
  sandboxApiKey: true, sandboxApiSecret: true,
  portalEnabled: true, lastLoginAt: true,
  webhookUrl: true, webhookEnabled: true,
  depositBalance: true, sbpBalance: true, promptpayBalance: true, esimBalance: true, vpnBalance: true, amlBalance: true,
  sbpMargin: true, promptpayMargin: true, esimMargin: true, vpnMargin: true, amlMargin: true,
  sbpEnabled: true, promptpayEnabled: true, esimEnabled: true, vpnEnabled: true, transitEnabled: true, amlEnabled: true,
  depositWalletId: true, depositWalletAddress: true, depositWalletBaseline: true,
  createdAt: true, updatedAt: true,
  _count: { select: { transactions: true, deposits: true, ipWhitelist: true } },
};

// Expose whether a portal password is set (never the hash itself).
async function withPasswordFlag(client) {
  const row = await prisma.client.findUnique({ where: { id: client.id }, select: { passwordHash: true } });
  return { ...client, hasPassword: !!row?.passwordHash };
}

// GET /api/admin/clients
router.get('/', async (req, res) => {
  try {
    const { skip, take, orderBy, where } = parseList(req.query, {
      allowedFilters: ['status', 'name', 'email', 'company', 'id'],
    });
    const [rows, total] = await Promise.all([
      prisma.client.findMany({ skip, take, orderBy, where, select: publicSelect }),
      prisma.client.count({ where }),
    ]);
    sendList(res, serialize(rows), total);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/clients/:id
router.get('/:id', async (req, res) => {
  const client = await prisma.client.findUnique({
    where: { id: req.params.id },
    select: { ...publicSelect, ipWhitelist: true },
  });
  if (!client) return res.status(404).json({ error: 'Not found' });
  res.json(serialize(await withPasswordFlag(client)));
});

// POST /api/admin/clients — create reseller (auto keys + optional deposit wallet)
router.post('/', async (req, res) => {
  try {
    const { name, email, company, status, ipRestricted, sbpMargin, promptpayMargin, esimMargin, vpnMargin, amlMargin, createWallet, password, portalEnabled,
      sbpEnabled, promptpayEnabled, esimEnabled, vpnEnabled, transitEnabled, amlEnabled } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name обязателен' });
    if (portalEnabled && !email) return res.status(400).json({ error: 'Для кабинета клиента нужен email' });
    if (password && String(password).length < 8) return res.status(400).json({ error: 'Пароль минимум 8 символов' });

    let depositWalletId = null;
    let depositWalletAddress = null;
    if (createWallet) {
      try {
        const w = await cryptoOffice.createWallet(`bill:${name}`.slice(0, 40));
        depositWalletId = String(w.id);
        depositWalletAddress = w.address;
      } catch (e) {
        console.error('[clients] wallet create failed:', e.response?.data || e.message);
        return res.status(502).json({ error: 'Не удалось создать депозитный кошелёк: ' + e.message });
      }
    }

    const client = await prisma.client.create({
      data: {
        name, email: email || null, company: company || null,
        status: status || 'ACTIVE',
        ipRestricted: ipRestricted !== false,
        sbpMargin: sbpMargin != null ? Number(sbpMargin) : null,
        promptpayMargin: promptpayMargin != null ? Number(promptpayMargin) : null,
        esimMargin: esimMargin != null ? Number(esimMargin) : null,
        vpnMargin: vpnMargin != null ? Number(vpnMargin) : null,
        amlMargin: amlMargin != null ? Number(amlMargin) : null,
        sbpEnabled: sbpEnabled !== false,
        promptpayEnabled: promptpayEnabled !== false,
        esimEnabled: !!esimEnabled,
        vpnEnabled: !!vpnEnabled,
        transitEnabled: !!transitEnabled,
        amlEnabled: !!amlEnabled,
        apiKey: generateApiKey(), apiSecret: generateApiSecret(),
        sandboxApiKey: 'sk_' + generateApiKey().slice(3), sandboxApiSecret: 'ss_sbx_' + generateApiSecret().slice(3),
        depositWalletId, depositWalletAddress,
        portalEnabled: !!portalEnabled,
        passwordHash: password ? await bcrypt.hash(String(password), 10) : null,
      },
      select: publicSelect,
    });
    res.status(201).json(serialize(await withPasswordFlag(client)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/admin/clients/:id
router.patch('/:id', async (req, res) => {
  try {
    const { name, email, company, status, ipRestricted, sbpMargin, promptpayMargin, esimMargin, vpnMargin, amlMargin, password, portalEnabled,
      sbpEnabled, promptpayEnabled, esimEnabled, vpnEnabled, transitEnabled, amlEnabled } = req.body || {};
    const data = {};
    if (name !== undefined) data.name = name;
    if (email !== undefined) data.email = email || null;
    if (company !== undefined) data.company = company || null;
    if (status !== undefined) data.status = status;
    if (ipRestricted !== undefined) data.ipRestricted = !!ipRestricted;
    if (portalEnabled !== undefined) data.portalEnabled = !!portalEnabled;
    if (sbpEnabled !== undefined) data.sbpEnabled = !!sbpEnabled;
    if (promptpayEnabled !== undefined) data.promptpayEnabled = !!promptpayEnabled;
    if (esimEnabled !== undefined) data.esimEnabled = !!esimEnabled;
    if (vpnEnabled !== undefined) data.vpnEnabled = !!vpnEnabled;
    if (transitEnabled !== undefined) data.transitEnabled = !!transitEnabled;
    if (amlEnabled !== undefined) data.amlEnabled = !!amlEnabled;
    if (sbpMargin !== undefined) data.sbpMargin = sbpMargin === null || sbpMargin === '' ? null : Number(sbpMargin);
    if (promptpayMargin !== undefined) data.promptpayMargin = promptpayMargin === null || promptpayMargin === '' ? null : Number(promptpayMargin);
    if (esimMargin !== undefined) data.esimMargin = esimMargin === null || esimMargin === '' ? null : Number(esimMargin);
    if (vpnMargin !== undefined) data.vpnMargin = vpnMargin === null || vpnMargin === '' ? null : Number(vpnMargin);
    if (amlMargin !== undefined) data.amlMargin = amlMargin === null || amlMargin === '' ? null : Number(amlMargin);
    if (password) {
      if (String(password).length < 8) return res.status(400).json({ error: 'Пароль минимум 8 символов' });
      data.passwordHash = await bcrypt.hash(String(password), 10);
    }

    const client = await prisma.client.update({ where: { id: req.params.id }, data, select: publicSelect });
    res.json(serialize(await withPasswordFlag(client)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/clients/:id/adjust-balance — manual balance correction
// body: { balanceType: DEPOSIT|SBP|PROMPTPAY|ESIM, amount (signed), note }
router.post('/:id/adjust-balance', async (req, res) => {
  try {
    const { balanceType, amount, note } = req.body || {};
    if (!['DEPOSIT', 'SBP', 'PROMPTPAY', 'ESIM', 'VPN'].includes(balanceType)) return res.status(400).json({ error: 'Неверный тип баланса' });
    if (amount === undefined || Number(amount) === 0) return res.status(400).json({ error: 'Ненулевая сумма обязательна' });
    const updated = await adjustBalance(req.params.id, req.admin?.sub || null, balanceType, Number(amount), note || 'Ручная корректировка');
    res.json(serialize({ id: updated.id, depositBalance: updated.depositBalance, sbpBalance: updated.sbpBalance, promptpayBalance: updated.promptpayBalance, esimBalance: updated.esimBalance, vpnBalance: updated.vpnBalance, amlBalance: updated.amlBalance }));
  } catch (e) {
    if (e.code === 'NEGATIVE_BALANCE') return res.status(400).json({ error: e.message, code: e.code });
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/clients/:id/statement?month=YYYY-MM — monthly PDF statement (with profit)
router.get('/:id/statement', async (req, res) => {
  try {
    const client = await prisma.client.findUnique({ where: { id: req.params.id } });
    if (!client) return res.status(404).json({ error: 'Not found' });
    const { from, to, monthLabel } = monthRange(req.query.month);
    const data = await collectStatement(client, from, to);
    const pdf = await generateStatement(client, { ...data, monthLabel, includeProfit: true });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="statement_${client.name.replace(/\W+/g, '_')}_${req.query.month || 'current'}.pdf"`);
    res.send(pdf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/clients/:id/rotate-keys — regenerate API credentials
router.post('/:id/rotate-keys', async (req, res) => {
  try {
    const client = await prisma.client.update({
      where: { id: req.params.id },
      data: { apiKey: generateApiKey(), apiSecret: generateApiSecret() },
      select: publicSelect,
    });
    res.json(serialize(client));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/clients/:id/wallet — create a deposit wallet if missing
router.post('/:id/wallet', async (req, res) => {
  try {
    const existing = await prisma.client.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (existing.depositWalletId) return res.json(serialize(existing));
    const w = await cryptoOffice.createWallet(`bill:${existing.name}`.slice(0, 40));
    const client = await prisma.client.update({
      where: { id: req.params.id },
      data: { depositWalletId: String(w.id), depositWalletAddress: w.address },
      select: publicSelect,
    });
    res.json(serialize(client));
  } catch (e) { res.status(502).json({ error: e.response?.data?.message || e.message }); }
});

// DELETE /api/admin/clients/:id
router.delete('/:id', async (req, res) => {
  try {
    await prisma.client.delete({ where: { id: req.params.id } });
    res.json({ id: req.params.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
