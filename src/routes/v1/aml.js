// Reseller relay for AML (Love&Pay address risk-check + PDF). A check charges the
// client's AML balance (fixed price × (1 + margin)).
import { Router } from 'express';
import prisma from '../../db.js';
import config from '../../config.js';
import { runCheck, getReport, history, checkPrice, detectNetwork } from '../../lib/amlBilling.js';
import { serialize, toNum } from '../../lib/money.js';
import { idempotency } from '../../middleware/idempotency.js';

const router = Router();

// GET /v1/aml/price — client-facing price per check
router.get('/price', (req, res) => {
  const price = checkPrice(req.client);
  res.json({ pricePerCheck: price.chargedUsdt, currency: 'USDT', networks: ['tron', 'ethereum', 'bitcoin'] });
});

// POST /v1/aml/check { address } — run a risk check (charges AML balance).
router.post('/check', idempotency, async (req, res) => {
  const { address } = req.body || {};
  if (!address) return res.status(400).json({ error: 'address required' });
  try {
    const r = await runCheck(req.client, address, {
      sandbox: req.sandbox,
      reportPathFor: (id) => `/v1/aml/checks/${id}/report`,
    });
    res.json(serialize(r));
  } catch (e) {
    if (e.code === 'INVALID_ADDRESS') return res.status(400).json({ error: e.message, code: e.code });
    if (e.code === 'INSUFFICIENT_BALANCE') return res.status(402).json({ error: e.message, code: e.code, required: e.required, balance: toNum(req.client.amlBalance) });
    if (e.code === 'AML_FAILED') return res.status(502).json({ error: e.message, code: e.code });
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/aml/checks — recent checks for this client
router.get('/checks', async (req, res) => {
  const take = Math.min(parseInt(req.query.limit || '100', 10) || 100, 500);
  res.json(serialize(await history(req.client, take)));
});

// GET /v1/aml/checks/:id — one check's stored result
router.get('/checks/:id', async (req, res) => {
  const row = await prisma.amlCheck.findFirst({ where: { id: req.params.id, clientId: req.client.id } });
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(serialize(row));
});

// GET /v1/aml/checks/:id/report — PDF report for a stored check (no charge)
router.get('/checks/:id/report', async (req, res) => {
  try {
    const { pdf, filename } = await getReport(req.client, req.params.id);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: e.message });
    res.status(502).json({ error: 'Не удалось сформировать PDF' });
  }
});

export default router;
