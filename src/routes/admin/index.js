import { Router } from 'express';
import { adminAuth } from '../../middleware/adminAuth.js';
import clients from './clients.js';
import deposits from './deposits.js';
import allocations from './allocations.js';
import transactions from './transactions.js';
import ipWhitelist from './ipWhitelist.js';
import ledger from './ledger.js';
import dashboard from './dashboard.js';
import cardApplications from './cardApplications.js';

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
router.use('/dashboard', dashboard);

export default router;
