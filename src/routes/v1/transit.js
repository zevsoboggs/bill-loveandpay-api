// Reseller relay for transit wallets. Each partner's wallets are namespaced by
// project = `lnp_<clientId>`; a partner can only see/manage its own. Topup
// (funding from the platform master) is admin-only and not exposed here.
import { Router } from 'express';
import transit from '../../services/transitApi.js';

const router = Router();
const err = (res, e) => res.status(e.response?.status || 502).json({ error: e.response?.data?.error || e.message });
const projectOf = (req) => `lnp_${req.client.id}`;

// Verify a wallet belongs to this partner's namespace.
async function ownWallet(req, id) {
  const w = await transit.getWallet(id);
  const wallet = w?.wallet || w;
  if (!wallet || wallet.project !== projectOf(req)) return null;
  return wallet;
}

// GET /v1/transit/networks — available networks/coins
router.get('/networks', async (req, res) => { try { res.json(await transit.networks()); } catch (e) { err(res, e); } });

// POST /v1/transit/wallets { network, label } — create (project forced to partner)
router.post('/wallets', async (req, res) => {
  try {
    const { network, label } = req.body || {};
    if (!network) return res.status(400).json({ error: 'network обязателен' });
    res.json(await transit.createWallet({ network, label, project: projectOf(req) }));
  } catch (e) { err(res, e); }
});

// GET /v1/transit/wallets?balances=1 — this partner's wallets
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

// POST /v1/transit/wallets/:id/transfer { coin, toAddress, amount } — send out
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
