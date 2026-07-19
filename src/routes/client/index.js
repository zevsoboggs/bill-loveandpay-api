import { Router } from 'express';
import { clientPortalAuth } from '../../middleware/clientPortalAuth.js';
import authRoutes from './auth.js';
import portalRoutes from './portal.js';
import esimRoutes from './esim.js';
import vpnRoutes from './vpn.js';
import webhookRoutes from './webhook.js';

const router = Router();

// Public: login / (change-password is guarded inside auth.js)
router.use('/auth', authRoutes);

// Everything else requires a client-portal JWT.
router.use('/esim', clientPortalAuth, esimRoutes);
router.use('/vpn', clientPortalAuth, vpnRoutes);
router.use('/webhook', clientPortalAuth, webhookRoutes);
router.use(clientPortalAuth, portalRoutes);

export default router;
