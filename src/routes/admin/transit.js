// Admin transit-wallet management — full proxy to the external transit-api.
import { Router } from 'express';
import transit from '../../services/transitApi.js';

const router = Router();
const err = (res, e) => res.status(e.response?.status || 502).json({ error: e.response?.data?.error || e.message });

router.get('/networks', async (req, res) => { try { res.json(await transit.networks()); } catch (e) { err(res, e); } });
router.get('/master', async (req, res) => { try { res.json(await transit.master()); } catch (e) { err(res, e); } });

router.get('/wallets', async (req, res) => {
  try { res.json(await transit.listWallets({ project: req.query.project, balances: req.query.balances })); } catch (e) { err(res, e); }
});
router.post('/wallets', async (req, res) => {
  try {
    const { network, label, project } = req.body || {};
    if (!network) return res.status(400).json({ error: 'network обязателен' });
    res.json(await transit.createWallet({ network, label, project }));
  } catch (e) { err(res, e); }
});
router.get('/wallets/:id', async (req, res) => { try { res.json(await transit.getWallet(req.params.id)); } catch (e) { err(res, e); } });
router.get('/wallets/:id/balance', async (req, res) => { try { res.json(await transit.walletBalance(req.params.id)); } catch (e) { err(res, e); } });

router.post('/wallets/:id/topup', async (req, res) => {
  try {
    const { amount, coin } = req.body || {};
    if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'amount обязателен' });
    res.json(await transit.topup(req.params.id, { amount: Number(amount), coin }));
  } catch (e) { err(res, e); }
});
router.post('/wallets/:id/transfer', async (req, res) => {
  try {
    const { coin, toAddress, amount } = req.body || {};
    if (!toAddress || !amount) return res.status(400).json({ error: 'toAddress и amount обязательны' });
    res.json(await transit.transfer(req.params.id, { coin: coin ?? 1, toAddress, amount: Number(amount) }));
  } catch (e) { err(res, e); }
});
router.post('/wallets/:id/rename', async (req, res) => {
  try {
    const { label } = req.body || {};
    res.json(await transit.rename(req.params.id, { label }));
  } catch (e) { err(res, e); }
});

export default router;
