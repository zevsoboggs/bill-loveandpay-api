import { Router } from 'express';
import prisma from '../../db.js';
import { toNum } from '../../lib/money.js';

const router = Router();

const parseRange = (q) => {
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 86400 * 1000);
  return { from, to };
};

// GET /api/admin/analytics?from=&to= — platform revenue/margin analytics
router.get('/', async (req, res) => {
  try {
    const { from, to } = parseRange(req.query);

    // Daily series per system (COMPLETED only).
    const rows = await prisma.$queryRaw`
      SELECT date_trunc('day', "createdAt") AS day, system,
             COUNT(*)::int AS count, COALESCE(SUM("chargedUsdt"),0) AS volume, COALESCE(SUM("marginUsdt"),0) AS margin
      FROM transactions
      WHERE status = 'COMPLETED' AND "createdAt" >= ${from} AND "createdAt" <= ${to}
      GROUP BY day, system ORDER BY day ASC`;

    const byDay = {};
    for (const r of rows) {
      const key = new Date(r.day).toISOString().slice(0, 10);
      byDay[key] ||= { day: key, SBP: 0, PROMPTPAY: 0, ESIM: 0, VPN: 0, margin: 0, volume: 0, count: 0 };
      byDay[key][r.system] = toNum(r.volume);
      byDay[key].margin += toNum(r.margin);
      byDay[key].volume += toNum(r.volume);
      byDay[key].count += r.count;
    }
    const series = Object.values(byDay);

    // Totals per system + grand totals.
    const bySystem = await prisma.transaction.groupBy({
      by: ['system'], where: { status: 'COMPLETED', createdAt: { gte: from, lte: to } },
      _sum: { chargedUsdt: true, marginUsdt: true }, _count: true,
    });
    const totals = { volume: 0, margin: 0, count: 0, systems: {} };
    for (const s of bySystem) {
      totals.systems[s.system] = { volume: toNum(s._sum.chargedUsdt), margin: toNum(s._sum.marginUsdt), count: s._count };
      totals.volume += toNum(s._sum.chargedUsdt);
      totals.margin += toNum(s._sum.marginUsdt);
      totals.count += s._count;
    }

    // Status breakdown + top clients.
    const byStatus = await prisma.transaction.groupBy({ by: ['status'], where: { createdAt: { gte: from, lte: to } }, _count: true });
    const topClients = await prisma.$queryRaw`
      SELECT c.name, COALESCE(SUM(t."chargedUsdt"),0) AS volume, COALESCE(SUM(t."marginUsdt"),0) AS margin, COUNT(*)::int AS count
      FROM transactions t JOIN clients c ON c.id = t."clientId"
      WHERE t.status = 'COMPLETED' AND t."createdAt" >= ${from} AND t."createdAt" <= ${to}
      GROUP BY c.id, c.name ORDER BY volume DESC LIMIT 10`;

    res.json({
      range: { from, to },
      series,
      totals,
      byStatus: byStatus.reduce((a, r) => ({ ...a, [r.status]: r._count }), {}),
      topClients: topClients.map((c) => ({ name: c.name, volume: toNum(c.volume), margin: toNum(c.margin), count: c.count })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
