// Client-cabinet VPN API (req.portalClient). Mirrors /v1/vpn.
import { Router } from 'express';
import prisma from '../../db.js';
import * as vpnd from '../../services/vpnd.js';
import { catalog, buy, myKeys } from '../../lib/vpnBilling.js';
import { serialize, toNum } from '../../lib/money.js';

const router = Router();

router.use((req, res, next) => {
  if (!req.portalClient?.vpnEnabled) return res.status(403).json({ error: 'Услуга VPN не подключена', code: 'SERVICE_DISABLED' });
  next();
});

router.get('/locations', async (req, res) => {
  try { res.json(serialize(await catalog(req.portalClient))); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

router.post('/buy', async (req, res) => {
  const { locationId, rfHost } = req.body || {};
  if (!locationId && !rfHost) return res.status(400).json({ error: 'locationId или rfHost обязательны' });
  try {
    const r = await buy(req.portalClient, { locationId, rfHost });
    res.json(serialize({ success: true, transactionId: r.transactionId, amountUsdt: r.amountUsdt,
      key: { id: r.key.id, location: r.key.locationLabel, protocol: r.key.protocol, config: r.key.config, qr: r.key.qr, expiresAt: r.key.expiresAt } }));
  } catch (e) {
    if (e.code === 'INSUFFICIENT_BALANCE') return res.status(402).json({ error: e.message, code: e.code, required: e.required, balance: toNum(req.portalClient.vpnBalance) });
    if (e.code === 'BAD_TARGET') return res.status(400).json({ error: e.message });
    if (e.code === 'VPN_FAILED') return res.status(502).json({ error: e.message, code: e.code });
    res.status(500).json({ error: e.message });
  }
});

router.get('/my', async (req, res) => res.json(serialize(await myKeys(req.portalClient))));

router.get('/:id/ovpn', async (req, res) => {
  try {
    const key = await prisma.vpnKey.findFirst({ where: { id: req.params.id, clientId: req.portalClient.id } });
    if (!key || !key.locationId) return res.status(404).json({ error: 'Not found' });
    const ovpn = await vpnd.getOvpnConfig(req.query.proto || 'udp', key.locationId);
    if (!ovpn) return res.status(502).json({ error: 'OpenVPN config unavailable' });
    res.json({ ovpn });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

export default router;
