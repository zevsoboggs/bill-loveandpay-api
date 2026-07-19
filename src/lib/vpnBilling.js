// Shared VPN billing logic (relay + cabinet). Provisions vpnd.io keys; a purchase
// charges the client's VPN balance (fixed base price + client margin).
import prisma from '../db.js';
import config from '../config.js';
import * as vpnd from '../services/vpnd.js';
import { priceFromCost } from './pricing.js';
import { chargeSystem, refundSystem } from './ledger.js';
import { toNum } from './money.js';
import { dispatch, EVENTS } from '../services/webhooks.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const err = (msg, code, extra) => Object.assign(new Error(msg), { code, ...extra });

// Price for one key for this client (base cost × (1 + margin)).
export function keyPrice(client) {
  return priceFromCost(client, 'VPN', config.vpn.priceUsdt);
}

// Catalog: RF DPI-bypass servers + RU/world locations + the client's price.
export async function catalog(client) {
  const [locs, rf] = await Promise.all([vpnd.listLocations(), vpnd.listRfServers()]);
  const price = keyPrice(client);
  return {
    priceUsdt: price.chargedUsdt, marginRate: price.marginRate, durationDays: config.vpn.durationDays,
    rf: rf.map((s) => ({ host: s.host, iso2: (s.host.match(/^[a-z]{2}/) || [''])[0], name: s.name.replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '').trim() })),
    ru: locs.filter((l) => l.ru),
    world: locs.filter((l) => !l.ru),
  };
}

// Buy a VPN key. target = { locationId } (VLESS) or { rfHost } (Shadowsocks, RF).
export async function buy(client, { locationId, rfHost }) {
  // Resolve target + provision function
  let label, protocol, iso2 = null, country = null, provision;
  if (rfHost) {
    const rf = await vpnd.listRfServers();
    const srv = rf.find((s) => s.host === String(rfHost).toLowerCase());
    if (!srv) throw err('Unknown RF server', 'BAD_TARGET');
    label = `${srv.name} (РФ)`; protocol = 'shadowsocks'; iso2 = (srv.host.match(/^[a-z]{2}/) || [''])[0];
    provision = async () => ({ config: srv.ss });
  } else if (locationId) {
    const locs = await vpnd.listLocations();
    const loc = locs.find((l) => l.id === Number(locationId));
    if (!loc) throw err('Unknown location', 'BAD_TARGET');
    label = `${loc.country}${loc.city ? ', ' + loc.city : ''}`; protocol = 'vless'; iso2 = loc.iso2; country = loc.country;
    // Fetch the text config (vless://…); the QR is rendered client-side from it.
    provision = async () => {
      try { return await vpnd.createVlessKey(Number(locationId)); }
      catch (e) { if (e.code === 'VPND_RATELIMIT') { await sleep(3500); return vpnd.createVlessKey(Number(locationId)); } throw e; }
    };
  } else {
    throw err('locationId или rfHost обязательны', 'BAD_TARGET');
  }

  const price = keyPrice(client);
  const tx = await prisma.transaction.create({
    data: {
      clientId: client.id, system: 'VPN', status: 'PROCESSING',
      providerCostUsdt: price.providerCostUsdt, marginUsdt: price.marginUsdt, chargedUsdt: price.chargedUsdt,
      description: `VPN — ${label} (${config.vpn.durationDays} дн.)`,
      metadata: { locationId: locationId || null, rfHost: rfHost || null, protocol, label },
    },
  });

  try {
    await chargeSystem(client.id, 'VPN', price.chargedUsdt, { refId: tx.id, note: 'VPN purchase' });
  } catch (e) {
    await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'FAILED' } });
    if (e.code === 'INSUFFICIENT_BALANCE') throw err('Недостаточно средств на VPN-балансе', 'INSUFFICIENT_BALANCE', { required: price.chargedUsdt });
    throw e;
  }

  let key = null;
  try { key = await provision(); } catch (e) { key = null; }
  if (!key?.config) {
    await refundSystem(client.id, 'VPN', price.chargedUsdt, { refId: tx.id, note: 'VPN provision failed — refund' });
    await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'FAILED' } });
    dispatch(client.id, EVENTS.PAYMENT_FAILED, { system: 'VPN', transactionId: tx.id, amountUsdt: price.chargedUsdt, error: 'VPN_FAILED' });
    throw err('Не удалось выдать VPN-ключ, средства возвращены', 'VPN_FAILED');
  }

  const expiresAt = new Date(Date.now() + config.vpn.durationDays * 86400 * 1000);
  const vpnKey = await prisma.vpnKey.create({
    data: {
      clientId: client.id, locationId: locationId ? Number(locationId) : null, locationLabel: label,
      country, iso2, protocol, config: key.config, qr: key.qr || null,
      priceUsdt: config.vpn.priceUsdt, chargedUsdt: price.chargedUsdt, durationDays: config.vpn.durationDays,
      status: 'ACTIVE', expiresAt, metadata: { rfHost: rfHost || null },
    },
  });

  await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'COMPLETED', providerRef: vpnKey.id } });
  dispatch(client.id, EVENTS.PAYMENT_COMPLETED, { system: 'VPN', transactionId: tx.id, amountUsdt: price.chargedUsdt });
  dispatch(client.id, EVENTS.VPN_ISSUED, { transactionId: tx.id, keyId: vpnKey.id, location: label, protocol, expiresAt, amountUsdt: price.chargedUsdt });

  return { transactionId: tx.id, amountUsdt: price.chargedUsdt, key: vpnKey };
}

export async function myKeys(client) {
  return prisma.vpnKey.findMany({ where: { clientId: client.id }, orderBy: { createdAt: 'desc' }, take: 200 });
}
