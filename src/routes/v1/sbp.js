// Reseller relay for SBP (СБП via USDT). Client's SBP balance is charged the
// provider cost + the client's margin; the QR is paid from the platform float.
import { Router } from 'express';
import prisma from '../../db.js';
import sbp from '../../services/sbp.js';
import { priceFromCost } from '../../lib/pricing.js';
import { chargeSystem, refundSystem } from '../../lib/ledger.js';
import { serialize, toNum } from '../../lib/money.js';
import { dispatch, EVENTS } from '../../services/webhooks.js';

const router = Router();

// GET /v1/sbp/rate — current USDT/RUB rate
router.get('/rate', async (req, res) => {
  try {
    const r = await sbp.getRate();
    // White-label: expose only the rate, hide the upstream source.
    res.json({ rate: Number(r?.rate) || null, currency: r?.currency || 'RUB', updatedAt: r?.updatedAt || null });
  } catch (e) { res.status(502).json({ error: e.response?.data?.error || e.message }); }
});

// POST /v1/sbp/quote { qrData } — parse QR, return the price WITHOUT charging.
router.post('/quote', async (req, res) => {
  try {
    const { qrData } = req.body || {};
    if (!qrData) return res.status(400).json({ error: 'qrData required' });
    const payment = await sbp.createPayment(qrData);
    const baseUsdt = toNum(payment.usdtAmount);
    const price = priceFromCost(req.client, 'SBP', baseUsdt);
    res.json(serialize({
      quote: true,
      rubAmount: payment.rubAmount,
      amountUsdt: price.chargedUsdt,
      marginRate: price.marginRate,
      merchant: payment.paymentDetails?.merchant,
      bank: payment.paymentDetails?.bank,
    }));
  } catch (e) { res.status(502).json({ error: e.response?.data?.error || e.message }); }
});

// POST /v1/sbp/pay { qrData } — charge the client's SBP balance and pay the QR.
router.post('/pay', async (req, res) => {
  const client = req.client;
  const { qrData } = req.body || {};
  if (!qrData) return res.status(400).json({ error: 'qrData required' });

  // 1) Authoritative amount from the QR (never trust client-supplied numbers).
  let quote;
  try {
    quote = await sbp.createPayment(qrData);
  } catch (e) {
    return res.status(502).json({ error: 'Не удалось распознать QR: ' + (e.response?.data?.error || e.message) });
  }
  const baseUsdt = toNum(quote.usdtAmount);
  if (!(baseUsdt > 0)) return res.status(400).json({ error: 'Не удалось определить сумму по QR' });
  const price = priceFromCost(client, 'SBP', baseUsdt);

  // 2) Record the intent + debit the SBP balance atomically.
  const tx = await prisma.transaction.create({
    data: {
      clientId: client.id, system: 'SBP', status: 'PROCESSING',
      sourceAmount: quote.rubAmount != null ? Number(quote.rubAmount) : null, sourceCurrency: 'RUB',
      providerCostUsdt: price.providerCostUsdt, marginUsdt: price.marginUsdt, chargedUsdt: price.chargedUsdt,
      description: `СБП ${quote.rubAmount || ''} RUB → ${quote.paymentDetails?.merchant || 'QR'}`,
      metadata: { qrData, baseUsdt, merchant: quote.paymentDetails?.merchant, bank: quote.paymentDetails?.bank },
    },
  });

  try {
    await chargeSystem(client.id, 'SBP', price.chargedUsdt, { refId: tx.id, note: 'SBP payment' });
  } catch (e) {
    await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'FAILED', description: (tx.description || '') + ' — недостаточно средств' } });
    if (e.code === 'INSUFFICIENT_BALANCE') {
      return res.status(402).json({ error: 'Недостаточно средств на SBP-балансе', code: 'INSUFFICIENT_BALANCE', required: price.chargedUsdt, balance: toNum(client.sbpBalance) });
    }
    return res.status(500).json({ error: e.message });
  }

  // 3) Pay the QR from the platform float.
  let result;
  try {
    result = await sbp.quickPay(qrData);
  } catch (e) {
    // Refund the client — money was debited but the QR did not go through.
    await refundSystem(client.id, 'SBP', price.chargedUsdt, { refId: tx.id, note: 'SBP payment failed — refund' });
    await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'FAILED', metadata: { ...tx.metadata, error: String(e.response?.data?.error || e.message).slice(0, 200) } } });
    dispatch(client.id, EVENTS.PAYMENT_FAILED, { system: 'SBP', transactionId: tx.id, amountUsdt: price.chargedUsdt, error: 'SBP_FAILED' });
    return res.status(502).json({ error: 'Оплата СБП не прошла, средства возвращены', code: 'SBP_FAILED' });
  }

  // 4) Success.
  const updated = await prisma.transaction.update({
    where: { id: tx.id },
    data: {
      status: 'COMPLETED', providerRef: result.id ? String(result.id) : null,
      metadata: { ...tx.metadata, providerResult: { total: result.paymentDetails?.total, merchant: result.paymentDetails?.merchant, bank: result.paymentDetails?.bank } },
    },
  });

  dispatch(client.id, EVENTS.PAYMENT_COMPLETED, {
    system: 'SBP', transactionId: updated.id, amountUsdt: price.chargedUsdt,
    sourceAmount: result.paymentDetails?.total ?? quote.rubAmount, sourceCurrency: 'RUB',
    providerRef: updated.providerRef, merchant: result.paymentDetails?.merchant, bank: result.paymentDetails?.bank,
  });

  res.json(serialize({
    success: true,
    transactionId: updated.id,
    providerRef: updated.providerRef,
    rubAmount: result.paymentDetails?.total ?? quote.rubAmount,
    amountUsdt: price.chargedUsdt,
    merchant: result.paymentDetails?.merchant,
    bank: result.paymentDetails?.bank,
    status: 'COMPLETED',
  }));
});

// GET /v1/sbp/payment/:id — status of one of the client's SBP transactions
router.get('/payment/:id', async (req, res) => {
  const tx = await prisma.transaction.findFirst({ where: { id: req.params.id, clientId: req.client.id, system: 'SBP' } });
  if (!tx) return res.status(404).json({ error: 'Not found' });
  res.json(serialize({ transactionId: tx.id, status: tx.status, providerRef: tx.providerRef, amountUsdt: tx.chargedUsdt, rubAmount: tx.sourceAmount, createdAt: tx.createdAt }));
});

export default router;
