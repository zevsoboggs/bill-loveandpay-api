// Client-cabinet AML API (req.portalClient). Mirrors /v1/aml using the shared
// billing logic. Requires the partner to have the AML service enabled.
import { Router } from 'express';
import prisma from '../../db.js';
import { runCheck, getReport, history, checkPrice } from '../../lib/amlBilling.js';
import { serialize, toNum } from '../../lib/money.js';

const router = Router();

// Guard: AML must be enabled for this partner.
router.use((req, res, next) => {
  if (!req.portalClient?.amlEnabled) return res.status(403).json({ error: 'Услуга AML не подключена', code: 'SERVICE_DISABLED' });
  next();
});

// GET /api/client/aml/price
router.get('/price', (req, res) => {
  const price = checkPrice(req.portalClient);
  res.json({ pricePerCheck: price.chargedUsdt, currency: 'USDT', balance: toNum(req.portalClient.amlBalance) });
});

// POST /api/client/aml/check { address }
router.post('/check', async (req, res) => {
  const { address } = req.body || {};
  if (!address) return res.status(400).json({ error: 'address required' });
  try {
    const r = await runCheck(req.portalClient, address, { reportPathFor: (id) => `/api/client/aml/checks/${id}/report` });
    res.json(serialize(r));
  } catch (e) {
    if (e.code === 'INVALID_ADDRESS') return res.status(400).json({ error: e.message, code: e.code });
    if (e.code === 'INSUFFICIENT_BALANCE') return res.status(402).json({ error: e.message, code: e.code, required: e.required, balance: toNum(req.portalClient.amlBalance) });
    if (e.code === 'AML_FAILED') return res.status(502).json({ error: e.message, code: e.code });
    res.status(500).json({ error: e.message });
  }
});

// GET /api/client/aml/checks — history
router.get('/checks', async (req, res) => {
  res.json(serialize(await history(req.portalClient, 100)));
});

// GET /api/client/aml/checks/:id/report — PDF (no charge)
router.get('/checks/:id/report', async (req, res) => {
  try {
    const { pdf, filename } = await getReport(req.portalClient, req.params.id);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: e.message });
    res.status(502).json({ error: 'Не удалось сформировать PDF' });
  }
});

export default router;
