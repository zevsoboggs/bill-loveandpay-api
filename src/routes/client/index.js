import { Router } from 'express';
import { clientPortalAuth } from '../../middleware/clientPortalAuth.js';
import authRoutes from './auth.js';
import portalRoutes from './portal.js';
import esimRoutes from './esim.js';
import vpnRoutes from './vpn.js';
import transitRoutes from './transit.js';
import amlRoutes from './aml.js';
import webhookRoutes from './webhook.js';
import notificationRoutes from './notifications.js';

const router = Router();

// Public: login / (change-password is guarded inside auth.js)
router.use('/auth', authRoutes);

// Everything else requires a client-portal JWT.
router.use('/esim', clientPortalAuth, esimRoutes);
router.use('/vpn', clientPortalAuth, vpnRoutes);
router.use('/transit', clientPortalAuth, transitRoutes);
router.use('/aml', clientPortalAuth, amlRoutes);
router.use('/webhook', clientPortalAuth, webhookRoutes);
router.use('/notifications', clientPortalAuth, notificationRoutes);
router.use(clientPortalAuth, portalRoutes);

export default router;
