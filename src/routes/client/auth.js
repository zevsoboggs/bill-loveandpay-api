import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../../db.js';
import config from '../../config.js';
import { clientPortalAuth } from '../../middleware/clientPortalAuth.js';

const router = Router();

// POST /api/client/auth/login → { token, client }
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email и password обязательны' });

    const client = await prisma.client.findFirst({
      where: { email: String(email).toLowerCase(), portalEnabled: true, passwordHash: { not: null } },
    });
    if (!client) return res.status(401).json({ error: 'Неверный email или пароль' });

    const ok = await bcrypt.compare(password, client.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Неверный email или пароль' });
    if (client.status === 'SUSPENDED') return res.status(403).json({ error: 'Аккаунт заблокирован' });

    await prisma.client.update({ where: { id: client.id }, data: { lastLoginAt: new Date() } });
    const token = jwt.sign({ sub: client.id, type: 'client', email: client.email, name: client.name },
      config.jwt.secret, { expiresIn: config.jwt.expiresIn });
    res.json({ token, client: { id: client.id, name: client.name, email: client.email } });
  } catch (e) {
    console.error('[client/login]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/client/auth/change-password (authenticated)
router.post('/change-password', clientPortalAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Новый пароль минимум 8 символов' });
    const client = req.portalClient;
    const ok = await bcrypt.compare(currentPassword || '', client.passwordHash || '');
    if (!ok) return res.status(400).json({ error: 'Текущий пароль неверный' });
    await prisma.client.update({ where: { id: client.id }, data: { passwordHash: await bcrypt.hash(newPassword, 10) } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
