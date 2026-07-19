import { Router } from 'express';
import prisma from '../../db.js';
import { serialize, toNum } from '../../lib/money.js';
import sbp from '../../services/sbp.js';
import promptpay from '../../services/promptpay.js';
import cryptoOffice from '../../services/cryptoOffice.js';

const router = Router();

// GET /api/admin/dashboard/stats — headline numbers for the admin home.
router.get('/stats', async (req, res) => {
  try {
    const [clients, activeClients, txAgg, txByStatus, balAgg, depAgg] = await Promise.all([
      prisma.client.count(),
      prisma.client.count({ where: { status: 'ACTIVE' } }),
      prisma.transaction.groupBy({ by: ['system'], _sum: { chargedUsdt: true, marginUsdt: true, providerCostUsdt: true }, _count: true }),
      prisma.transaction.groupBy({ by: ['status'], _count: true }),
      prisma.client.aggregate({ _sum: { depositBalance: true, sbpBalance: true, promptpayBalance: true, esimBalance: true, vpnBalance: true } }),
      prisma.deposit.aggregate({ _sum: { amountUsdt: true }, where: { status: 'CREDITED' } }),
    ]);

    const bySystem = {};
    for (const s of ['SBP', 'PROMPTPAY', 'ESIM', 'VPN']) {
      const row = txAgg.find((r) => r.system === s);
      bySystem[s] = {
        count: row?._count || 0,
        volumeUsdt: toNum(row?._sum.chargedUsdt),
        marginUsdt: toNum(row?._sum.marginUsdt),
        providerCostUsdt: toNum(row?._sum.providerCostUsdt),
      };
    }

    res.json(serialize({
      clients: { total: clients, active: activeClients },
      balances: {
        depositUsdt: toNum(balAgg._sum.depositBalance),
        sbpUsdt: toNum(balAgg._sum.sbpBalance),
        promptpayUsdt: toNum(balAgg._sum.promptpayBalance),
        esimUsdt: toNum(balAgg._sum.esimBalance),
        vpnUsdt: toNum(balAgg._sum.vpnBalance),
        totalOnPlatformUsdt: toNum(balAgg._sum.depositBalance) + toNum(balAgg._sum.sbpBalance) + toNum(balAgg._sum.promptpayBalance) + toNum(balAgg._sum.esimBalance) + toNum(balAgg._sum.vpnBalance),
      },
      totalDepositedUsdt: toNum(depAgg._sum.amountUsdt),
      transactions: {
        bySystem,
        byStatus: txByStatus.reduce((a, r) => ({ ...a, [r.status]: r._count }), {}),
        totalMarginUsdt: bySystem.SBP.marginUsdt + bySystem.PROMPTPAY.marginUsdt,
      },
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/dashboard/providers — live float on the platform's provider
// accounts + the CryptoOffice master wallet. Used to decide top-ups.
router.get('/providers', async (req, res) => {
  const out = { sbp: null, promptpay: null, cryptoOffice: null };
  await Promise.all([
    sbp.getBalance().then((b) => { out.sbp = b; }).catch((e) => { out.sbp = { error: e.message }; }),
    promptpay.getAccount().then((b) => { out.promptpay = b; }).catch((e) => { out.promptpay = { error: e.message }; }),
    cryptoOffice.listMainWallets('tron').then((b) => { out.cryptoOffice = b?.data || b; }).catch((e) => { out.cryptoOffice = { error: e.message }; }),
  ]);
  res.json(out);
});

export default router;
