import prisma from '../db.js';
import { toNum } from './money.js';

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

// month = 'YYYY-MM' (defaults to current month). Returns { from, to, monthLabel }.
export function monthRange(month) {
  const now = new Date();
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth();
  if (month && /^\d{4}-\d{2}$/.test(month)) { const [yy, mm] = month.split('-').map(Number); y = yy; m = mm - 1; }
  const from = new Date(Date.UTC(y, m, 1, 0, 0, 0));
  const to = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59));
  return { from, to, monthLabel: `${MONTHS[m]} ${y}` };
}

export async function collectStatement(client, from, to) {
  const [deposits, bySystem] = await Promise.all([
    prisma.deposit.aggregate({ where: { clientId: client.id, status: 'CREDITED', createdAt: { gte: from, lte: to } }, _sum: { amountUsdt: true }, _count: true }),
    prisma.transaction.groupBy({ by: ['system'], where: { clientId: client.id, status: 'COMPLETED', createdAt: { gte: from, lte: to } }, _sum: { chargedUsdt: true, marginUsdt: true }, _count: true }),
  ]);
  return {
    from, to,
    deposits: { count: deposits._count, sum: toNum(deposits._sum.amountUsdt) },
    bySystem: bySystem.map((s) => ({ system: s.system, count: s._count, spent: toNum(s._sum.chargedUsdt), margin: toNum(s._sum.marginUsdt) })),
    balances: { deposit: toNum(client.depositBalance), sbp: toNum(client.sbpBalance), promptpay: toNum(client.promptpayBalance), esim: toNum(client.esimBalance), vpn: toNum(client.vpnBalance) },
  };
}
