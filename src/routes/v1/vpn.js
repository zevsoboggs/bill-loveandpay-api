// Reseller relay for VPN (vpnd.io). Catalog + purchase (charges VPN balance).
import { Router } from 'express';
import prisma from '../../db.js';
import * as vpnd from '../../services/vpnd.js';
import { catalog, buy, myKeys } from '../../lib/vpnBilling.js';
import { serialize, toNum } from '../../lib/money.js';
import { idempotency } from '../../middleware/idempotency.js';
import { sandboxVpn } from '../../lib/sandbox.js';

const router = Router();

// GET /v1/vpn/locations — servers + client price
router.get('/locations', async (req, res) => {
  try { res.json(serialize(await catalog(req.client))); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

// POST /v1/vpn/buy { locationId } | { rfHost }
router.post('/buy', idempotency, async (req, res) => {
  const { locationId, rfHost } = req.body || {};
  if (!locationId && !rfHost) return res.status(400).json({ error: 'locationId или rfHost обязательны' });
  if (req.sandbox) return res.json(sandboxVpn());
  try {
    const r = await buy(req.client, { locationId, rfHost });
    res.json(serialize({
      success: true, transactionId: r.transactionId, amountUsdt: r.amountUsdt,
      key: { id: r.key.id, location: r.key.locationLabel, protocol: r.key.protocol, config: r.key.config, qr: r.key.qr, expiresAt: r.key.expiresAt },
    }));
  } catch (e) {
    if (e.code === 'INSUFFICIENT_BALANCE') return res.status(402).json({ error: e.message, code: e.code, required: e.required, balance: toNum(req.client.vpnBalance) });
    if (e.code === 'BAD_TARGET') return res.status(400).json({ error: e.message });
    if (e.code === 'VPN_FAILED') return res.status(502).json({ error: e.message, code: e.code });
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/vpn/my — this client's VPN keys
router.get('/my', async (req, res) => res.json(serialize(await myKeys(req.client))));

// GET /v1/vpn/:id/ovpn?proto=tcp|udp|udp_ru — OpenVPN config for the key's location
router.get('/:id/ovpn', async (req, res) => {
  try {
    const key = await prisma.vpnKey.findFirst({ where: { id: req.params.id, clientId: req.client.id } });
    if (!key || !key.locationId) return res.status(404).json({ error: 'Not found' });
    const ovpn = await vpnd.getOvpnConfig(req.query.proto || 'udp', key.locationId);
    if (!ovpn) return res.status(502).json({ error: 'OpenVPN config unavailable' });
    res.json({ ovpn });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

export default router;
