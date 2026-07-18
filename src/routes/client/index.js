import { Router } from 'express';
import { clientPortalAuth } from '../../middleware/clientPortalAuth.js';
import authRoutes from './auth.js';
import portalRoutes from './portal.js';

const router = Router();

// Public: login / (change-password is guarded inside auth.js)
router.use('/auth', authRoutes);

// Everything else requires a client-portal JWT.
router.use(clientPortalAuth, portalRoutes);

export default router;
