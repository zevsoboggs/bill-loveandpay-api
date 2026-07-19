// Reseller relay for Yesim eSIM. Catalog + lifecycle passthrough; issue/topup
// charge the client's eSIM balance (see lib/esimBilling.js). Full Yesim coverage.
import { Router } from 'express';
import prisma from '../../db.js';
import yesim from '../../services/yesim.js';
import { catalog, findPlan, annotatePlan, issue, topup } from '../../lib/esimBilling.js';
import { serialize, toNum } from '../../lib/money.js';
import { idempotency } from '../../middleware/idempotency.js';
import { sandboxEsim, sandboxPayment } from '../../lib/sandbox.js';

const router = Router();

// GET /v1/esim/plans?country=&search=&limit= — catalog with client USDT prices
router.get('/plans', async (req, res) => {
  try {
    const { country, search, limit } = req.query;
    res.json(serialize(await catalog(req.client, { country, search, limit })));
  } catch (e) { res.status(502).json({ error: e.response?.data?.message || e.message }); }
});

router.get('/plans/:id', async (req, res) => {
  const plan = await findPlan(req.params.id);
  if (!plan) return res.status(404).json({ error: 'Plan not found' });
  res.json(serialize(await annotatePlan(req.client, plan)));
});

// POST /v1/esim/issue { planId, count } — buy eSIM(s)
router.post('/issue', idempotency, async (req, res) => {
  const { planId, count } = req.body || {};
  if (!planId) return res.status(400).json({ error: 'planId required' });
  if (req.sandbox) return res.json(sandboxEsim(Math.max(1, Math.min(parseInt(count || 1, 10) || 1, 50))));
  try {
    const r = await issue(req.client, planId, count || 1);
    res.json(serialize({ success: true, transactionId: r.transactionId, amountUsdt: r.amountUsdt, count: r.count,
      esims: r.esims.map((e) => ({ iccid: e.iccid, qrcode: e.qrcode, img: e.img, dataPackageMb: e.data_package_mb, status: e.status_qr })) }));
  } catch (e) {
    if (e.code === 'INSUFFICIENT_BALANCE') return res.status(402).json({ error: e.message, code: e.code, required: e.required, balance: toNum(req.client.esimBalance) });
    if (e.code === 'PLAN_NOT_FOUND') return res.status(404).json({ error: e.message });
    if (e.code === 'ESIM_FAILED') return res.status(502).json({ error: e.message, code: e.code });
    res.status(500).json({ error: e.message });
  }
});

// POST /v1/esim/topup { iccid, planId }
router.post('/topup', idempotency, async (req, res) => {
  const { iccid, planId } = req.body || {};
  if (!iccid || !planId) return res.status(400).json({ error: 'iccid и planId обязательны' });
  if (req.sandbox) return res.json(sandboxPayment({ system: 'ESIM', iccid }));
  try {
    res.json(serialize({ success: true, ...(await topup(req.client, iccid, planId)) }));
  } catch (e) {
    if (e.code === 'INSUFFICIENT_BALANCE') return res.status(402).json({ error: e.message, code: e.code, required: e.required });
    if (e.code === 'PLAN_NOT_FOUND') return res.status(404).json({ error: e.message });
    if (e.code === 'ESIM_FAILED') return res.status(502).json({ error: e.message, code: e.code });
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/esim/my — this client's issued eSIMs
router.get('/my', async (req, res) => {
  const rows = await prisma.esim.findMany({ where: { clientId: req.client.id }, orderBy: { createdAt: 'desc' }, take: 200 });
  res.json(serialize(rows));
});

// ── Read-only / lifecycle passthroughs ────────────────────────────────────────
router.get('/sim/:iccid', async (req, res) => {
  try { res.json(await yesim.simInfo(req.params.iccid)); } catch (e) { res.status(502).json({ error: e.message }); }
});
router.get('/orders', async (req, res) => {
  try { res.json(await yesim.getOrders(req.query.search || '')); } catch (e) { res.status(502).json({ error: e.message }); }
});
router.get('/supported-devices', async (req, res) => {
  try { res.json(await yesim.getSupportedDevices()); } catch (e) { res.status(502).json({ error: e.message }); }
});
router.get('/allowed-operators', async (req, res) => {
  try { res.json(await yesim.getAllowedOperators()); } catch (e) { res.status(502).json({ error: e.message }); }
});
router.post('/cancel', async (req, res) => {
  try {
    const { iccid } = req.body || {};
    if (!iccid) return res.status(400).json({ error: 'iccid required' });
    res.json(await yesim.cancelPlan(iccid));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

export default router;
