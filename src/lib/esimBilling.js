// Shared eSIM billing logic used by both the relay API (/v1/esim) and the client
// cabinet (/api/client/esim). Handles catalog pricing, purchase (charge → issue →
// record → refund-on-failure) and top-up.
import prisma from '../db.js';
import yesim from '../services/yesim.js';
import { eurToUsdt } from './fx.js';
import { priceFromCost } from './pricing.js';
import { chargeSystem, refundSystem } from './ledger.js';
import { toNum, round6 } from './money.js';
import { dispatch, EVENTS } from '../services/webhooks.js';

let plansCache = { at: 0, list: [] };
export async function loadPlans() {
  const now = Date.now();
  if (plansCache.list.length && now - plansCache.at < 5 * 60 * 1000) return plansCache.list;
  const list = await yesim.getPlans();
  plansCache = { at: now, list: Array.isArray(list) ? list : [] };
  return plansCache.list;
}
export const findPlan = async (planId) => (await loadPlans()).find((p) => String(p.id) === String(planId));

export async function annotatePlan(client, plan) {
  const costUsdt = await eurToUsdt(toNum(plan.price));
  const price = priceFromCost(client, 'ESIM', costUsdt);
  // White-label: never expose the upstream provider (carrier operators / provider CDN).
  return {
    id: plan.id, name: plan.name, country: plan.countries_included, countryIso2: plan.countryIso2,
    data: plan.data, dataUnit: plan.data_unit, days: plan.days,
    planType: plan.plan_type,
    priceEur: toNum(plan.price), priceUsdt: price.chargedUsdt, marginRate: price.marginRate,
  };
}

export async function catalog(client, { country, search, limit = 500 } = {}) {
  let plans = await loadPlans();
  if (country) {
    const q = String(country).toLowerCase();
    // Exact ISO2 or exact country name — avoids substring false-matches (TH vs Lithuania).
    plans = plans.filter((p) => (p.countryIso2 || '').toLowerCase() === q || (p.countries_included || '').toLowerCase() === q);
  }
  if (search) { const s = String(search).toLowerCase(); plans = plans.filter((p) => (p.name || '').toLowerCase().includes(s) || (p.countries_included || '').toLowerCase().includes(s)); }
  const cap = Math.min(parseInt(limit, 10) || 500, 2000);
  const annotated = await Promise.all(plans.slice(0, cap).map((p) => annotatePlan(client, p)));
  return { total: plans.length, plans: annotated };
}

const err = (msg, code, extra) => Object.assign(new Error(msg), { code, ...extra });

// Purchase `count` eSIMs on a plan. Charges the client's eSIM balance, issues via
// Yesim, records eSIMs + a transaction; refunds on provider failure.
export async function issue(client, planId, count = 1) {
  count = Math.max(1, Math.min(parseInt(count, 10) || 1, 50));
  const plan = await findPlan(planId);
  if (!plan) throw err('Plan not found', 'PLAN_NOT_FOUND');

  const unitUsdt = await eurToUsdt(toNum(plan.price));
  const price = priceFromCost(client, 'ESIM', round6(unitUsdt * count));

  const tx = await prisma.transaction.create({
    data: {
      clientId: client.id, system: 'ESIM', status: 'PROCESSING',
      sourceAmount: round6(toNum(plan.price) * count), sourceCurrency: 'EUR',
      providerCostUsdt: price.providerCostUsdt, marginUsdt: price.marginUsdt, chargedUsdt: price.chargedUsdt,
      description: `eSIM ${plan.name} ×${count}`,
      metadata: { planId, planName: plan.name, count, priceEur: toNum(plan.price) },
    },
  });

  try {
    await chargeSystem(client.id, 'ESIM', price.chargedUsdt, { refId: tx.id, note: 'eSIM purchase' });
  } catch (e) {
    await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'FAILED' } });
    if (e.code === 'INSUFFICIENT_BALANCE') throw err('Недостаточно средств на eSIM-балансе', 'INSUFFICIENT_BALANCE', { required: price.chargedUsdt });
    throw e;
  }

  let result;
  try {
    result = await yesim.issueEsim(planId, count);
  } catch (e) {
    await refundSystem(client.id, 'ESIM', price.chargedUsdt, { refId: tx.id, note: 'eSIM issue failed — refund' });
    await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'FAILED', metadata: { ...tx.metadata, error: String(e.response?.data || e.message).slice(0, 200) } } });
    dispatch(client.id, EVENTS.PAYMENT_FAILED, { system: 'ESIM', transactionId: tx.id, amountUsdt: price.chargedUsdt, error: 'ESIM_FAILED' });
    throw err('Не удалось выпустить eSIM, средства возвращены', 'ESIM_FAILED');
  }

  const esims = Array.isArray(result?.esims) ? result.esims : [];
  await Promise.all(esims.map((e) => prisma.esim.create({
    data: {
      clientId: client.id, iccid: e.iccid ? String(e.iccid) : null, planId: String(planId), planName: plan.name,
      country: plan.countries_included, dataAmount: String(plan.data ?? ''), days: String(plan.days ?? ''),
      priceEur: toNum(plan.price), chargedUsdt: round6(price.chargedUsdt / count),
      qrcode: e.qrcode || null, status: e.status_qr || 'Released', yesimUserId: e.user_id ? String(e.user_id) : null,
      metadata: { activePlanId: e.active_plan_id, img: e.img, msisdn: e.msisdn, imsi: e.imsi },
    },
  })));

  await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'COMPLETED', providerRef: esims.map((e) => e.iccid).join(',') || null } });

  const esimSummary = esims.map((e) => ({ iccid: e.iccid, qrcode: e.qrcode, status: e.status_qr }));
  dispatch(client.id, EVENTS.PAYMENT_COMPLETED, { system: 'ESIM', transactionId: tx.id, amountUsdt: price.chargedUsdt, sourceAmount: round6(toNum(plan.price) * count), sourceCurrency: 'EUR' });
  dispatch(client.id, EVENTS.ESIM_ISSUED, { transactionId: tx.id, planName: plan.name, country: plan.countries_included, count, amountUsdt: price.chargedUsdt, esims: esimSummary });

  return { transactionId: tx.id, amountUsdt: price.chargedUsdt, count, esims };
}

export async function topup(client, iccid, planId) {
  const plan = await findPlan(planId);
  if (!plan) throw err('Plan not found', 'PLAN_NOT_FOUND');
  const price = priceFromCost(client, 'ESIM', await eurToUsdt(toNum(plan.price)));

  const tx = await prisma.transaction.create({
    data: {
      clientId: client.id, system: 'ESIM', status: 'PROCESSING',
      sourceAmount: toNum(plan.price), sourceCurrency: 'EUR',
      providerCostUsdt: price.providerCostUsdt, marginUsdt: price.marginUsdt, chargedUsdt: price.chargedUsdt,
      description: `eSIM top-up ${plan.name} → ${iccid}`, metadata: { iccid, planId, planName: plan.name },
    },
  });

  try {
    await chargeSystem(client.id, 'ESIM', price.chargedUsdt, { refId: tx.id, note: 'eSIM top-up' });
  } catch (e) {
    await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'FAILED' } });
    if (e.code === 'INSUFFICIENT_BALANCE') throw err('Недостаточно средств на eSIM-балансе', 'INSUFFICIENT_BALANCE', { required: price.chargedUsdt });
    throw e;
  }

  try {
    await yesim.addPlanIccid(iccid, planId, tx.id);
  } catch (e) {
    await refundSystem(client.id, 'ESIM', price.chargedUsdt, { refId: tx.id, note: 'eSIM top-up failed — refund' });
    await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'FAILED' } });
    throw err('Пополнение eSIM не прошло, средства возвращены', 'ESIM_FAILED');
  }

  await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'COMPLETED', providerRef: String(iccid) } });
  return { transactionId: tx.id, iccid, amountUsdt: price.chargedUsdt };
}
