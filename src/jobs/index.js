import cron from 'node-cron';
import prisma from '../db.js';
import { pollAll } from '../services/depositWatcher.js';
import sbp from '../services/sbp.js';
import promptpay from '../services/promptpay.js';
import { notify } from '../services/notifications.js';
import { buy as buyVpn } from '../lib/vpnBilling.js';

// Snapshot current SBP + PromptPay rates for the cabinet rate-history chart.
async function snapshotRates() {
  try {
    const r = await sbp.getRate();
    const rate = Number(r?.rate);
    if (rate > 0) await prisma.rateSnapshot.create({ data: { system: 'SBP', rate } });
  } catch (e) { console.error('[jobs] rate snapshot SBP:', e.message); }
  try {
    const r = await promptpay.getRate();
    const rate = Number(r?.данные?.курс_usdt_thb);
    if (rate > 0) await prisma.rateSnapshot.create({ data: { system: 'PROMPTPAY', rate } });
  } catch (e) { console.error('[jobs] rate snapshot PromptPay:', e.message); }
}

// Notify partners of soon-to-expire VPN keys; auto-renew when opted in.
async function checkVpnExpiry() {
  const now = new Date();
  const soon = new Date(now.getTime() + 3 * 86400 * 1000);
  const keys = await prisma.vpnKey.findMany({
    where: { status: 'ACTIVE', expiresAt: { gt: now, lte: soon } },
    include: { client: { select: { id: true, vpnAutoRenew: true } } },
  });
  for (const k of keys) {
    try {
      const meta = k.metadata || {};
      const dayOne = new Date(now.getTime() + 86400 * 1000);
      const expiringToday = k.expiresAt <= dayOne;

      // Auto-renew when the client opted in and the key is within 24h of expiry.
      if (expiringToday && k.client?.vpnAutoRenew) {
        try {
          const target = k.locationId ? { locationId: k.locationId } : { rfHost: meta.rfHost };
          const client = await prisma.client.findUnique({ where: { id: k.clientId } });
          const result = await buyVpn(client, target);
          await prisma.vpnKey.update({ where: { id: k.id }, data: { status: 'RENEWED', metadata: { ...meta, renewedTo: result.key.id } } });
          notify(k.clientId, 'vpn.issued', 'VPN автопродлён', `${k.locationLabel} · новый ключ выдан`);
          continue;
        } catch (e) {
          notify(k.clientId, 'vpn.expiring', 'Не удалось автопродлить VPN', `${k.locationLabel} — ${e.code === 'INSUFFICIENT_BALANCE' ? 'недостаточно средств на VPN-балансе' : 'ошибка провайдера'}`);
          await prisma.vpnKey.update({ where: { id: k.id }, data: { metadata: { ...meta, expiryNotified: true } } });
          continue;
        }
      }

      // Otherwise notify once when it first enters the 3-day window.
      if (!meta.expiryNotified) {
        const days = Math.max(1, Math.ceil((k.expiresAt - now) / 86400000));
        notify(k.clientId, 'vpn.expiring', 'VPN-ключ скоро истекает', `${k.locationLabel} — осталось ${days} дн. до ${k.expiresAt.toISOString().slice(0, 10)}`);
        await prisma.vpnKey.update({ where: { id: k.id }, data: { metadata: { ...meta, expiryNotified: true } } });
      }
    } catch (e) { console.error('[jobs] vpn expiry:', e.message); }
  }

  // Flag keys that have actually lapsed.
  await prisma.vpnKey.updateMany({ where: { status: 'ACTIVE', expiresAt: { lte: now } }, data: { status: 'EXPIRED' } });
}

// Background jobs.
export function startJobs() {
  // Deposit watcher — every minute.
  cron.schedule('* * * * *', async () => {
    try { await pollAll(); } catch (e) { console.error('[jobs] depositWatcher:', e.message); }
  });
  // Rate snapshots for the history chart — every 30 minutes.
  cron.schedule('*/30 * * * *', async () => {
    try { await snapshotRates(); } catch (e) { console.error('[jobs] rate snapshot:', e.message); }
  });
  // VPN expiry + auto-renew — daily at 09:00.
  cron.schedule('0 9 * * *', async () => {
    try { await checkVpnExpiry(); } catch (e) { console.error('[jobs] vpn expiry:', e.message); }
  });
  // Prune API logs older than 30 days — daily at 03:15.
  cron.schedule('15 3 * * *', async () => {
    try {
      const cutoff = new Date(Date.now() - 30 * 86400 * 1000);
      const { count } = await prisma.apiRequestLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
      if (count) console.log(`[jobs] pruned ${count} old API logs`);
    } catch (e) { console.error('[jobs] log prune:', e.message); }
  });
  // Seed one snapshot at boot so the chart isn't empty on first deploy.
  snapshotRates().catch(() => {});
  console.log('[jobs] deposit watcher (1m) + rate snapshots (30m) + VPN expiry (daily) + log prune (daily) scheduled');
}
