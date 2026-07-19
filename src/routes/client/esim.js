// Client-cabinet eSIM API (req.portalClient). Mirrors /v1/esim using the shared
// billing logic. Requires the partner to have the eSIM service enabled.
import { Router } from 'express';
import prisma from '../../db.js';
import yesim from '../../services/yesim.js';
import { catalog, findPlan, annotatePlan, issue } from '../../lib/esimBilling.js';
import { serialize, toNum } from '../../lib/money.js';

const router = Router();

// Guard: eSIM must be enabled for this partner.
router.use((req, res, next) => {
  if (!req.portalClient?.esimEnabled) return res.status(403).json({ error: 'Услуга eSIM не подключена', code: 'SERVICE_DISABLED' });
  next();
});

router.get('/plans', async (req, res) => {
  try {
    const { country, search, limit } = req.query;
    res.json(serialize(await catalog(req.portalClient, { country, search, limit })));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

router.get('/plans/:id', async (req, res) => {
  const plan = await findPlan(req.params.id);
  if (!plan) return res.status(404).json({ error: 'Plan not found' });
  res.json(serialize(await annotatePlan(req.portalClient, plan)));
});

router.post('/issue', async (req, res) => {
  const { planId, count } = req.body || {};
  if (!planId) return res.status(400).json({ error: 'planId required' });
  try {
    const r = await issue(req.portalClient, planId, count || 1);
    res.json(serialize({ success: true, transactionId: r.transactionId, amountUsdt: r.amountUsdt, count: r.count,
      esims: r.esims.map((e) => ({ iccid: e.iccid, qrcode: e.qrcode, img: e.img, dataPackageMb: e.data_package_mb, status: e.status_qr })) }));
  } catch (e) {
    if (e.code === 'INSUFFICIENT_BALANCE') return res.status(402).json({ error: e.message, code: e.code, required: e.required, balance: toNum(req.portalClient.esimBalance) });
    if (e.code === 'PLAN_NOT_FOUND') return res.status(404).json({ error: e.message });
    if (e.code === 'ESIM_FAILED') return res.status(502).json({ error: e.message, code: e.code });
    res.status(500).json({ error: e.message });
  }
});

router.get('/my', async (req, res) => {
  const rows = await prisma.esim.findMany({ where: { clientId: req.portalClient.id }, orderBy: { createdAt: 'desc' }, take: 200 });
  res.json(serialize(rows));
});

router.get('/sim/:iccid', async (req, res) => {
  try { res.json(await yesim.simInfo(req.params.iccid)); } catch (e) { res.status(502).json({ error: e.message }); }
});

// GET /api/client/esim/usage/:iccid — white-labeled data-usage summary.
// Defensive: providers vary the field names & units (bytes vs MB), so probe.
router.get('/usage/:iccid', async (req, res) => {
  try {
    const info = await yesim.simInfo(req.params.iccid);
    const d = info?.data || info?.sim || info || {};
    const num = (...keys) => {
      for (const k of keys) { const v = d[k] ?? info?.[k]; if (v != null && v !== '' && !isNaN(Number(v))) return Number(v); }
      return null;
    };
    // Providers report either bytes or MB — normalise to MB (heuristic: >100000 ⇒ bytes).
    const toMb = (v) => (v == null ? null : (v > 100000 ? Math.round(v / 1048576) : Math.round(v)));
    const totalMb = toMb(num('data_total', 'total_data', 'data_package_mb', 'traffic_total', 'volume'));
    const usedMb = toMb(num('data_used', 'used_data', 'traffic_used', 'used'));
    let remainMb = toMb(num('data_remaining', 'remaining_data', 'traffic_remaining', 'remaining', 'data_left'));
    if (remainMb == null && totalMb != null && usedMb != null) remainMb = Math.max(0, totalMb - usedMb);
    const status = d.status || d.state || info?.status || null;
    const expiry = d.expired_at || d.expiry || d.expire_date || d.valid_until || info?.expired_at || null;
    res.json({
      iccid: req.params.iccid,
      totalMb, usedMb, remainingMb: remainMb,
      usedPct: totalMb ? Math.min(100, Math.round(((usedMb ?? (totalMb - (remainMb ?? 0))) / totalMb) * 100)) : null,
      status, expiry,
    });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

export default router;
