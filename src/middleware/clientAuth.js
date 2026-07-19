// Authenticates a reseller calling the relay API.
//   X-API-Key:    client's public key
//   X-API-Secret: client's secret
// Plus IP whitelist enforcement (when client.ipRestricted) and status check.
import prisma from '../db.js';
import { safeEqual, normalizeIp } from '../lib/apiKeys.js';

function clientIp(req) {
  const xff = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return normalizeIp(xff || req.socket?.remoteAddress || req.ip);
}

export async function clientAuth(req, res, next) {
  try {
    const apiKey = req.headers['x-api-key'];
    const apiSecret = req.headers['x-api-secret'];
    if (!apiKey || !apiSecret) {
      return res.status(401).json({ error: 'Missing X-API-Key / X-API-Secret' });
    }

    const client = await prisma.client.findFirst({
      where: { OR: [{ apiKey: String(apiKey) }, { sandboxApiKey: String(apiKey) }] },
      include: { ipWhitelist: true },
    });
    if (!client) return res.status(401).json({ error: 'Invalid API credentials' });

    // Sandbox keys: simulated mode, no IP restriction.
    const isSandbox = client.sandboxApiKey === String(apiKey);
    const expectedSecret = isSandbox ? client.sandboxApiSecret : client.apiSecret;
    if (!safeEqual(apiSecret, expectedSecret)) {
      return res.status(401).json({ error: 'Invalid API credentials' });
    }
    if (client.status !== 'ACTIVE') {
      return res.status(403).json({ error: `Client is ${client.status}` });
    }

    const ip = clientIp(req);
    if (!isSandbox && client.ipRestricted) {
      const allowed = client.ipWhitelist.some((w) => w.ip === ip);
      if (!allowed) {
        return res.status(403).json({ error: `IP ${ip} is not whitelisted`, code: 'IP_NOT_ALLOWED' });
      }
    }

    req.client = client;
    req.clientIp = ip;
    req.sandbox = isSandbox;

    // Fire-and-forget request log.
    prisma.apiRequestLog
      .create({ data: { clientId: client.id, method: req.method, path: req.originalUrl, ip } })
      .catch(() => {});

    next();
  } catch (e) {
    console.error('[clientAuth]', e.message);
    res.status(500).json({ error: 'Auth error' });
  }
}
