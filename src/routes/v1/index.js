import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { clientAuth } from '../../middleware/clientAuth.js';
import { requireService } from '../../middleware/requireService.js';
import balance from './balance.js';
import sbp from './sbp.js';
import promptpay from './promptpay.js';
import esim from './esim.js';
import vpn from './vpn.js';
import transit from './transit.js';
import webhook from './webhook.js';

const router = Router();

// Per-client rate limit (keyed on API key, falls back to IP).
const limiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.headers['x-api-key'] || req.ip,
  message: { error: 'Слишком много запросов, попробуйте позже' },
});

router.use(limiter);
router.use(clientAuth); // API key + secret + IP whitelist

router.use('/balance', balance);
router.use('/webhook', webhook);
router.use('/sbp', requireService('SBP'), sbp);
router.use('/promptpay', requireService('PROMPTPAY'), promptpay);
router.use('/esim', requireService('ESIM'), esim);
router.use('/vpn', requireService('VPN'), vpn);
router.use('/transit', requireService('TRANSIT'), transit);

export default router;
