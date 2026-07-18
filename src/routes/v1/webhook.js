// Relay API webhook management (req.client, X-API-Key auth).
import { Router } from 'express';
import { getConfig, updateConfig, rotateSecret, listDeliveries, sendTest } from '../../lib/webhookConfig.js';

const router = Router();

router.get('/', async (req, res) => res.json(await getConfig(req.client)));

router.put('/', async (req, res) => {
  const { url, enabled } = req.body || {};
  if (url && !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'URL must start with http(s)://' });
  res.json(await updateConfig(req.client.id, { url, enabled }));
});

router.post('/rotate-secret', async (req, res) => res.json(await rotateSecret(req.client.id)));

router.post('/test', async (req, res) => {
  const r = await sendTest(req.client.id);
  res.status(r.ok ? 200 : 400).json(r);
});

router.get('/deliveries', async (req, res) => res.json(await listDeliveries(req.client.id)));

export default router;
