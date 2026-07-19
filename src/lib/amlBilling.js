// Shared AML billing logic (relay + cabinet). Runs a Love&Pay AML address
// risk-check; a check charges the client's AML balance (fixed base price ×
// (1 + margin)). The provider quota is our prepaid cost.
import prisma from '../db.js';
import config from '../config.js';
import aml from '../services/aml.js';
import { priceFromCost } from './pricing.js';
import { chargeSystem, refundSystem } from './ledger.js';
import { toNum } from './money.js';
import { dispatch, EVENTS } from '../services/webhooks.js';
import { notify } from '../services/notifications.js';

const err = (msg, code, extra) => Object.assign(new Error(msg), { code, ...extra });

// Light network detection for labelling & rejecting garbage. The provider
// auto-detects the real network.
export function detectNetwork(addr) {
  const a = (addr || '').trim();
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a)) return 'tron';
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) return 'ethereum';
  if (/^(bc1[0-9ac-hj-np-z]{6,87}|[13][1-9A-HJ-NP-Za-km-z]{25,39})$/.test(a)) return 'bitcoin';
  return null;
}

// Price for one check for this client (base × (1 + margin)).
export function checkPrice(client) {
  return priceFromCost(client, 'AML', config.aml.priceUsdt);
}

// White-label the provider result for API/cabinet responses (drop internal ids).
export function publicResult(r) {
  if (!r) return null;
  return {
    address: r.address,
    network: r.network,
    score: Number.isFinite(r.score) ? Math.round(r.score) : null,
    riskLevel: r.risk_level || null,
    verdict: r.verdict?.verdict || r.verdict?.code || null,
    verdictTitle: r.verdict?.title || null,
    action: r.verdict?.action || null,
    components: r.components || null,
    flags: r.flags || [],
    recommendations: r.recommendations || [],
    reportHash: r.report_hash || null,
    checkDate: r.check_date || null,
  };
}

// Simulated result for sandbox keys (no charge, no provider call).
export function sandboxCheck(address) {
  const network = detectNetwork(address) || 'tron';
  return {
    sandbox: true,
    check: {
      id: 'sbx_' + Math.abs(hash(address)).toString(16).slice(0, 12),
      address, network, score: 12, riskLevel: 'low',
      verdict: 'approve', verdictTitle: 'Низкий риск — операцию можно проводить',
      chargedUsdt: 0, createdAt: new Date().toISOString(),
    },
    result: {
      address, network: { id: network, label: network }, score: 12, riskLevel: 'low',
      verdict: 'approve', verdictTitle: 'Низкий риск — операцию можно проводить',
      action: 'Операцию можно проводить', flags: [], recommendations: [],
      reportHash: 'sandbox', checkDate: new Date().toISOString(),
    },
    reportUrl: null,
  };
}
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

// Run a check: validate → charge → call provider → store. Refunds on provider
// failure so a failed check never spends the client's balance. reportPathFor
// builds the white-label PDF link for the response.
export async function runCheck(client, address, { sandbox = false, reportPathFor } = {}) {
  const addr = String(address || '').trim();
  if (!addr || addr.length < 25 || addr.length > 120 || !detectNetwork(addr)) {
    throw err('Введите корректный адрес TRON, Ethereum или Bitcoin', 'INVALID_ADDRESS');
  }
  if (sandbox) return sandboxCheck(addr);

  const price = checkPrice(client);

  // Record the intent + debit the AML balance atomically.
  const tx = await prisma.transaction.create({
    data: {
      clientId: client.id, system: 'AML', status: 'PROCESSING',
      providerCostUsdt: price.providerCostUsdt, marginUsdt: price.marginUsdt, chargedUsdt: price.chargedUsdt,
      description: `AML-проверка ${addr.slice(0, 10)}…`,
      metadata: { address: addr },
    },
  });

  try {
    await chargeSystem(client.id, 'AML', price.chargedUsdt, { refId: tx.id, note: 'AML check' });
  } catch (e) {
    await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'FAILED' } });
    if (e.code === 'INSUFFICIENT_BALANCE') throw err('Недостаточно средств на AML-балансе', 'INSUFFICIENT_BALANCE', { required: price.chargedUsdt, balance: toNum(client.amlBalance) });
    throw e;
  }

  // Run the check — refund on provider failure.
  let result;
  try {
    result = await aml.checkAddress(addr);
  } catch (e) {
    await refundSystem(client.id, 'AML', price.chargedUsdt, { refId: tx.id, note: 'AML check failed — refund' });
    await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'FAILED', metadata: { address: addr, error: String(e.response?.status || e.message).slice(0, 200) } } });
    throw err('AML-сервис временно недоступен, средства возвращены', 'AML_FAILED');
  }

  const score = Number.isFinite(result?.score) ? Math.round(result.score) : null;
  const check = await prisma.amlCheck.create({
    data: {
      clientId: client.id, address: addr,
      network: result?.network?.label || detectNetwork(addr),
      score, riskLevel: result?.risk_level || null,
      verdict: result?.verdict?.verdict || result?.verdict?.code || null,
      verdictTitle: result?.verdict?.title || null,
      reportHash: result?.report_hash || null,
      chargedUsdt: price.chargedUsdt, transactionId: tx.id,
    },
  });

  await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'COMPLETED', providerRef: check.id } });
  notify(client.id, 'aml.checked', 'AML-проверка выполнена', `${addr.slice(0, 10)}… · риск ${riskLabel(result?.risk_level)} (${score ?? '—'}/100) · списано ${price.chargedUsdt} USDT`);
  dispatch(client.id, EVENTS.AML_CHECKED, { checkId: check.id, address: addr, network: check.network, score, riskLevel: check.riskLevel, verdict: check.verdict, amountUsdt: price.chargedUsdt });

  return {
    check: {
      id: check.id, address: check.address, network: check.network, score: check.score,
      riskLevel: check.riskLevel, verdict: check.verdict, verdictTitle: check.verdictTitle,
      reportHash: check.reportHash, chargedUsdt: price.chargedUsdt, createdAt: check.createdAt,
    },
    result: publicResult(result),
    amountUsdt: price.chargedUsdt,
    reportUrl: reportPathFor ? reportPathFor(check.id) : null,
  };
}

// Fetch the PDF report for a stored check owned by this client (no charge).
export async function getReport(client, checkId) {
  const check = await prisma.amlCheck.findFirst({ where: { id: checkId, clientId: client.id } });
  if (!check) throw err('Проверка не найдена', 'NOT_FOUND');
  const pdf = await aml.getReportPdf(check.address);
  return { pdf, filename: `LoveAndPay-AML-${check.address.slice(0, 8)}.pdf` };
}

export async function history(client, take = 100) {
  return prisma.amlCheck.findMany({ where: { clientId: client.id }, orderBy: { createdAt: 'desc' }, take });
}

export function riskLabel(level) {
  return { low: 'Низкий', medium: 'Средний', high: 'Высокий' }[level] || 'Неизвестно';
}
