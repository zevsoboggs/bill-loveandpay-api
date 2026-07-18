// Client-cabinet webhook management (req.portalClient).
import { Router } from 'express';
import { getConfig, updateConfig, rotateSecret, listDeliveries, sendTest } from '../../lib/webhookConfig.js';

const router = Router();

router.get('/', async (req, res) => {
  res.json(await getConfig(req.portalClient));
});

router.put('/', async (req, res) => {
  try {
    const { url, enabled } = req.body || {};
    if (url && !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'URL должен начинаться с http(s)://' });
    res.json(await updateConfig(req.portalClient.id, { url, enabled }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/rotate-secret', async (req, res) => {
  res.json(await rotateSecret(req.portalClient.id));
});

router.post('/test', async (req, res) => {
  const r = await sendTest(req.portalClient.id);
  res.status(r.ok ? 200 : 400).json(r);
});

router.get('/deliveries', async (req, res) => {
  res.json(await listDeliveries(req.portalClient.id));
});

export default router;
