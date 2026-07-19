// Client-cabinet transit-wallet API (req.portalClient). Mirrors /v1/transit —
// wallets namespaced by project `lnp_<clientId>`; no topup (admin-only funding).
import { Router } from 'express';
import transit from '../../services/transitApi.js';

const router = Router();
const err = (res, e) => res.status(e.response?.status || 502).json({ error: e.response?.data?.error || e.message });
const projectOf = (req) => `lnp_${req.portalClient.id}`;

router.use((req, res, next) => {
  if (!req.portalClient?.transitEnabled) return res.status(403).json({ error: 'Услуга «Транзитные кошельки» не подключена', code: 'SERVICE_DISABLED' });
  next();
});

async function ownWallet(req, id) {
  const w = await transit.getWallet(id);
  const wallet = w?.wallet || w;
  if (!wallet || wallet.project !== projectOf(req)) return null;
  return wallet;
}

router.get('/networks', async (req, res) => { try { res.json(await transit.networks()); } catch (e) { err(res, e); } });

router.post('/wallets', async (req, res) => {
  try {
    const { network, label } = req.body || {};
    if (!network) return res.status(400).json({ error: 'network обязателен' });
    res.json(await transit.createWallet({ network, label, project: projectOf(req) }));
  } catch (e) { err(res, e); }
});

router.get('/wallets', async (req, res) => {
  try { res.json(await transit.listWallets({ project: projectOf(req), balances: req.query.balances })); } catch (e) { err(res, e); }
});

router.get('/wallets/:id', async (req, res) => {
  try {
    const wallet = await ownWallet(req, req.params.id);
    if (!wallet) return res.status(404).json({ error: 'Not found' });
    res.json(wallet);
  } catch (e) { err(res, e); }
});

router.get('/wallets/:id/balance', async (req, res) => {
  try {
    if (!(await ownWallet(req, req.params.id))) return res.status(404).json({ error: 'Not found' });
    res.json(await transit.walletBalance(req.params.id));
  } catch (e) { err(res, e); }
});

router.post('/wallets/:id/transfer', async (req, res) => {
  try {
    if (!(await ownWallet(req, req.params.id))) return res.status(404).json({ error: 'Not found' });
    const { coin, toAddress, amount } = req.body || {};
    if (!toAddress || !amount) return res.status(400).json({ error: 'toAddress и amount обязательны' });
    res.json(await transit.transfer(req.params.id, { coin: coin ?? 1, toAddress, amount: Number(amount) }));
  } catch (e) { err(res, e); }
});

router.post('/wallets/:id/rename', async (req, res) => {
  try {
    if (!(await ownWallet(req, req.params.id))) return res.status(404).json({ error: 'Not found' });
    res.json(await transit.rename(req.params.id, { label: req.body?.label }));
  } catch (e) { err(res, e); }
});

export default router;
