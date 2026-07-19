import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import prisma from '../db.js';
import config from '../config.js';
import { adminAuth } from '../middleware/adminAuth.js';

const router = Router();
const ISSUER = 'bill.loveandpay.io';

// POST /api/admin/auth/login → { token, admin }
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email и password обязательны' });

    const admin = await prisma.adminUser.findUnique({ where: { email: String(email).toLowerCase() } });
    if (!admin || !admin.isActive) return res.status(401).json({ error: 'Неверный email или пароль' });

    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Неверный email или пароль' });

    // Second factor (Google Authenticator / TOTP) when the admin enabled it.
    if (admin.totpEnabled && admin.totpSecret) {
      const totp = String((req.body || {}).totp || '').replace(/\s/g, '');
      if (!totp) return res.status(401).json({ error: 'Введите код из приложения', code: 'TOTP_REQUIRED' });
      if (!authenticator.check(totp, admin.totpSecret)) {
        return res.status(401).json({ error: 'Неверный код 2FA', code: 'TOTP_INVALID' });
      }
    }

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
    select: { id: true, email: true, name: true, role: true, lastLoginAt: true, totpEnabled: true, avatarUrl: true },
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

// PATCH /api/admin/auth/me → update own name / avatar
router.patch('/me', adminAuth, async (req, res) => {
  try {
    const { name, avatarUrl } = req.body || {};
    if (avatarUrl != null && String(avatarUrl).length > 500000) return res.status(400).json({ error: 'Аватар слишком большой (макс ~500 КБ)' });
    const admin = await prisma.adminUser.update({
      where: { id: req.admin.sub },
      data: { name: name ?? undefined, avatarUrl: avatarUrl === undefined ? undefined : (avatarUrl || null) },
      select: { id: true, email: true, name: true, role: true, avatarUrl: true },
    });
    res.json(admin);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/auth/2fa/setup → generate a secret + otpauth URI (not yet enabled)
router.post('/2fa/setup', adminAuth, async (req, res) => {
  try {
    const admin = await prisma.adminUser.findUnique({ where: { id: req.admin.sub } });
    if (admin.totpEnabled) return res.status(400).json({ error: '2FA уже включена. Сначала отключите её.' });
    const secret = authenticator.generateSecret();
    await prisma.adminUser.update({ where: { id: admin.id }, data: { totpSecret: secret, totpEnabled: false } });
    const otpauth = authenticator.keyuri(admin.email, ISSUER, secret);
    res.json({ secret, otpauth });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/auth/2fa/enable { totp } → verify the first code and turn 2FA on
router.post('/2fa/enable', adminAuth, async (req, res) => {
  try {
    const totp = String((req.body || {}).totp || '').replace(/\s/g, '');
    const admin = await prisma.adminUser.findUnique({ where: { id: req.admin.sub } });
    if (!admin.totpSecret) return res.status(400).json({ error: 'Сначала выполните настройку 2FA' });
    if (!authenticator.check(totp, admin.totpSecret)) return res.status(400).json({ error: 'Неверный код, попробуйте ещё раз' });
    await prisma.adminUser.update({ where: { id: admin.id }, data: { totpEnabled: true } });
    res.json({ success: true, enabled: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/auth/2fa/disable { password, totp } → turn 2FA off
router.post('/2fa/disable', adminAuth, async (req, res) => {
  try {
    const { password, totp } = req.body || {};
    const admin = await prisma.adminUser.findUnique({ where: { id: req.admin.sub } });
    if (!admin.totpEnabled) return res.json({ success: true, enabled: false });
    const pwOk = await bcrypt.compare(password || '', admin.passwordHash);
    if (!pwOk) return res.status(400).json({ error: 'Пароль неверный' });
    if (!authenticator.check(String(totp || '').replace(/\s/g, ''), admin.totpSecret)) return res.status(400).json({ error: 'Неверный код 2FA' });
    await prisma.adminUser.update({ where: { id: admin.id }, data: { totpEnabled: false, totpSecret: null } });
    res.json({ success: true, enabled: false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
