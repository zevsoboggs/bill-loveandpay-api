import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../db.js';
import config from '../config.js';
import { adminAuth } from '../middleware/adminAuth.js';

const router = Router();

// POST /api/admin/auth/login → { token, admin }
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email и password обязательны' });

    const admin = await prisma.adminUser.findUnique({ where: { email: String(email).toLowerCase() } });
    if (!admin || !admin.isActive) return res.status(401).json({ error: 'Неверный email или пароль' });

    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Неверный email или пароль' });

    await prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });

    const token = jwt.sign(
      { sub: admin.id, email: admin.email, role: admin.role, name: admin.name },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn },
    );
    res.json({ token, admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role } });
  } catch (e) {
    console.error('[auth/login]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/auth/me → current admin
router.get('/me', adminAuth, async (req, res) => {
  const admin = await prisma.adminUser.findUnique({
    where: { id: req.admin.sub },
    select: { id: true, email: true, name: true, role: true, lastLoginAt: true },
  });
  if (!admin) return res.status(404).json({ error: 'Not found' });
  res.json(admin);
});

// POST /api/admin/auth/change-password
router.post('/change-password', adminAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Новый пароль минимум 8 символов' });
    const admin = await prisma.adminUser.findUnique({ where: { id: req.admin.sub } });
    const ok = await bcrypt.compare(currentPassword || '', admin.passwordHash);
    if (!ok) return res.status(400).json({ error: 'Текущий пароль неверный' });
    await prisma.adminUser.update({ where: { id: admin.id }, data: { passwordHash: await bcrypt.hash(newPassword, 10) } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/admin/auth/me → update own name
router.patch('/me', adminAuth, async (req, res) => {
  try {
    const { name } = req.body || {};
    const admin = await prisma.adminUser.update({
      where: { id: req.admin.sub }, data: { name: name ?? undefined },
      select: { id: true, email: true, name: true, role: true },
    });
    res.json(admin);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
