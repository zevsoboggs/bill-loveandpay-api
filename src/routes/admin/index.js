import { Router } from 'express';
import { adminAuth } from '../../middleware/adminAuth.js';
import clients from './clients.js';
import deposits from './deposits.js';
import allocations from './allocations.js';
import transactions from './transactions.js';
import ipWhitelist from './ipWhitelist.js';
import ledger from './ledger.js';
import dashboard from './dashboard.js';
import analytics from './analytics.js';
import cardApplications from './cardApplications.js';
import esims from './esims.js';
import vpnKeys from './vpnKeys.js';
import transit from './transit.js';
import amlChecks from './aml.js';
import corporateCards from './cards.js';
import depositWallets from './depositWallets.js';
import apiLogs from './apiLogs.js';

const router = Router();

// Everything under /api/admin/* requires a valid admin JWT.
router.use(adminAuth);

router.use('/clients', clients);
router.use('/deposits', deposits);
router.use('/allocations', allocations);
router.use('/transactions', transactions);
router.use('/ip-whitelist', ipWhitelist);
router.use('/ledger', ledger);
router.use('/card-applications', cardApplications);
router.use('/esims', esims);
router.use('/vpn-keys', vpnKeys);
router.use('/transit', transit);
router.use('/aml-checks', amlChecks);
router.use('/corporate-cards', corporateCards);
router.use('/deposit-wallets', depositWallets);
router.use('/api-logs', apiLogs);
router.use('/dashboard', dashboard);
router.use('/analytics', analytics);

export default router;
