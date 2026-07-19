import { Router } from 'express';
import { serialize, toNum } from '../../lib/money.js';
import { marginFor } from '../../lib/pricing.js';
import { minDepositFor } from '../../lib/deposits.js';

const router = Router();

// GET /v1/balance — the calling client's balances + effective margins.
router.get('/', (req, res) => {
  const c = req.client;
  res.json(serialize({
    clientId: c.id,
    name: c.name,
    currency: 'USDT',
    balances: {
      deposit: toNum(c.depositBalance),
      sbp: toNum(c.sbpBalance),
      promptpay: toNum(c.promptpayBalance),
      esim: toNum(c.esimBalance),
      vpn: toNum(c.vpnBalance),
    },
    margins: {
      sbp: marginFor(c, 'SBP'),
      promptpay: marginFor(c, 'PROMPTPAY'),
      esim: marginFor(c, 'ESIM'),
      vpn: marginFor(c, 'VPN'),
    },
    services: {
      sbp: c.sbpEnabled,
      promptpay: c.promptpayEnabled,
      esim: c.esimEnabled,
      vpn: c.vpnEnabled,
      transit: c.transitEnabled,
    },
    depositAddress: c.depositWalletAddress || null,
    depositNetwork: c.depositWalletAddress ? 'TRC-20' : null,
    minDeposit: minDepositFor(c),
  }));
});

export default router;
