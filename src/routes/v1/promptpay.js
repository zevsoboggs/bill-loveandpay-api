// Reseller relay for PromptPay (Thai QR). Client's PromptPay balance is charged
// provider cost + margin; the QR is paid from the platform float.
import { Router } from 'express';
import prisma from '../../db.js';
import promptpay from '../../services/promptpay.js';
import { priceFromCost } from '../../lib/pricing.js';
import { chargeSystem, refundSystem } from '../../lib/ledger.js';
import { serialize, toNum } from '../../lib/money.js';
import { dispatch, EVENTS } from '../../services/webhooks.js';

const router = Router();

// Provider returns Russian-keyed JSON: данные.итого_usdt is the USDT cost.
function providerCost(calcData) {
  const d = calcData?.данные || calcData?.data || {};
  return toNum(d.итого_usdt ?? d.total_usdt ?? 0);
}

// GET /v1/promptpay/rate
router.get('/rate', async (req, res) => {
  try {
    const r = await promptpay.getRate();
    res.json({ baseRate: r?.данные?.курс_usdt_thb ?? r?.data?.rate_usdt_thb ?? null, raw: r });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// POST /v1/promptpay/calculate { amountThb } — price without charging
router.post('/calculate', async (req, res) => {
  try {
    const { amountThb } = req.body || {};
    if (!amountThb || Number(amountThb) <= 0) return res.status(400).json({ error: 'amountThb required' });
    const calc = await promptpay.calculate(Number(amountThb));
    const base = providerCost(calc);
    const price = priceFromCost(req.client, 'PROMPTPAY', base);
    res.json(serialize({ quote: true, amountThb: Number(amountThb), amountUsdt: price.chargedUsdt, marginRate: price.marginRate }));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// POST /v1/promptpay/scan { qrData } — inspect a QR (amount, recipient)
router.post('/scan', async (req, res) => {
  try {
    const { qrData } = req.body || {};
    if (!qrData) return res.status(400).json({ error: 'qrData required' });
    res.json(await promptpay.scanQr(qrData));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// POST /v1/promptpay/pay { qrData, amountThb? }
router.post('/pay', async (req, res) => {
  const client = req.client;
  const { qrData } = req.body || {};
  let { amountThb } = req.body || {};
  if (!qrData) return res.status(400).json({ error: 'qrData required' });

  // Dynamic QR → scan for amount; static QR requires amountThb.
  if (!amountThb) {
    try {
      const scan = await promptpay.scanQr(qrData);
      const s = scan?.данные || scan?.data || {};
      amountThb = s.сумма_thb || s.amount_thb;
    } catch { /* fall through */ }
    if (!amountThb) return res.status(400).json({ error: 'Статический QR — укажите amountThb', code: 'AMOUNT_REQUIRED' });
  }

  // Price from provider calculate.
  let base;
  try {
    const calc = await promptpay.calculate(Number(amountThb));
    base = providerCost(calc);
  } catch (e) {
    return res.status(502).json({ error: 'Не удалось рассчитать стоимость: ' + e.message });
  }
  if (!(base > 0)) return res.status(400).json({ error: 'Провайдер вернул нулевую стоимость' });
  const price = priceFromCost(client, 'PROMPTPAY', base);

  const tx = await prisma.transaction.create({
    data: {
      clientId: client.id, system: 'PROMPTPAY', status: 'PROCESSING',
      sourceAmount: Number(amountThb), sourceCurrency: 'THB',
      providerCostUsdt: price.providerCostUsdt, marginUsdt: price.marginUsdt, chargedUsdt: price.chargedUsdt,
      description: `PromptPay ${amountThb} THB`,
      metadata: { qrData, amountThb: Number(amountThb), baseUsdt: base },
    },
  });

  try {
    await chargeSystem(client.id, 'PROMPTPAY', price.chargedUsdt, { refId: tx.id, note: 'PromptPay payment' });
  } catch (e) {
    await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'FAILED' } });
    if (e.code === 'INSUFFICIENT_BALANCE') {
      return res.status(402).json({ error: 'Недостаточно средств на PromptPay-балансе', code: 'INSUFFICIENT_BALANCE', required: price.chargedUsdt, balance: toNum(client.promptpayBalance) });
    }
    return res.status(500).json({ error: e.message });
  }

  let payResult;
  try {
    payResult = await promptpay.payQrAsync(qrData, Number(amountThb));
  } catch (e) {
    await refundSystem(client.id, 'PROMPTPAY', price.chargedUsdt, { refId: tx.id, note: 'PromptPay failed — refund' });
    await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'FAILED', metadata: { ...tx.metadata, error: String(e.response?.data || e.message).slice(0, 200) } } });
    dispatch(client.id, EVENTS.PAYMENT_FAILED, { system: 'PROMPTPAY', transactionId: tx.id, amountUsdt: price.chargedUsdt, error: 'PROMPTPAY_FAILED' });
    return res.status(502).json({ error: 'Оплата PromptPay не прошла, средства возвращены', code: 'PROMPTPAY_FAILED' });
  }

  const ppTxId = payResult?.данные?.id || payResult?.data?.id;
  const providerStatus = payResult?.данные?.status || payResult?.data?.status || 'pending';
  const slipUrl = payResult?.ссылка_на_слип || null;

  const updated = await prisma.transaction.update({
    where: { id: tx.id },
    data: {
      status: providerStatus === 'completed' || slipUrl ? 'COMPLETED' : 'PROCESSING',
      providerRef: ppTxId ? String(ppTxId) : null,
      metadata: { ...tx.metadata, ppTxId, providerStatus, slipUrl, receipt: payResult?.чек || null },
    },
  });

  if (updated.status === 'COMPLETED') {
    dispatch(client.id, EVENTS.PAYMENT_COMPLETED, {
      system: 'PROMPTPAY', transactionId: updated.id, amountUsdt: price.chargedUsdt,
      sourceAmount: Number(amountThb), sourceCurrency: 'THB', providerRef: ppTxId || null, slipUrl,
    });
  }

  res.json(serialize({
    success: true,
    transactionId: updated.id,
    providerRef: ppTxId || null,
    amountThb: Number(amountThb),
    amountUsdt: price.chargedUsdt,
    status: updated.status,
    receiptReady: !!slipUrl,
    slipUrl,
    checkReceiptAt: ppTxId ? `/v1/promptpay/receipt/${ppTxId}` : null,
  }));
});

// GET /v1/promptpay/receipt/:ppTxId — poll for the slip/receipt
router.get('/receipt/:ppTxId', async (req, res) => {
  try {
    const result = await promptpay.getReceipt(req.params.ppTxId);
    const receipt = result?.данные || result?.data || {};
    const slipUrl = receipt?.ссылка_на_слип || receipt?.slip_url || null;

    if (slipUrl) {
      const tx = await prisma.transaction.findFirst({
        where: { clientId: req.client.id, system: 'PROMPTPAY', providerRef: String(req.params.ppTxId) },
      });
      if (tx && tx.status !== 'COMPLETED') {
        await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'COMPLETED', metadata: { ...tx.metadata, slipUrl, receipt } } });
      }
    }
    res.json({ ready: !!slipUrl, slipUrl, receipt, slipDownload: slipUrl ? `/v1/promptpay/slip/${req.params.ppTxId}` : null });
  } catch (e) {
    if (e.response?.status === 409) return res.status(409).json({ ready: false, message: 'Чек ещё не готов, повторите через 3 сек' });
    res.status(e.response?.status || 502).json({ error: e.message });
  }
});

// GET /v1/promptpay/slip/:ppTxId — proxy the slip image
router.get('/slip/:ppTxId', async (req, res) => {
  try {
    const buf = await promptpay.getSlip(req.params.ppTxId);
    res.set('Content-Type', 'image/jpeg').send(buf);
  } catch (e) {
    if (e.response?.status === 409) return res.status(409).json({ error: 'Слип ещё не готов' });
    res.status(e.response?.status || 502).json({ error: e.message });
  }
});

export default router;
