import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import prisma from '../../db.js';
import config from '../../config.js';
import { clientPortalAuth } from '../../middleware/clientPortalAuth.js';

const router = Router();
const ISSUER = 'bill.loveandpay.io';

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

    // Second factor (Google Authenticator / TOTP) when the partner enabled it.
    if (client.totpEnabled && client.totpSecret) {
      const totp = String((req.body || {}).totp || '').replace(/\s/g, '');
      if (!totp) return res.status(401).json({ error: 'Введите код из приложения', code: 'TOTP_REQUIRED' });
      if (!authenticator.check(totp, client.totpSecret)) {
        return res.status(401).json({ error: 'Неверный код 2FA', code: 'TOTP_INVALID' });
      }
    }

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

// GET /api/client/auth/2fa — current 2FA state
router.get('/2fa', clientPortalAuth, async (req, res) => {
  const c = await prisma.client.findUnique({ where: { id: req.portalClient.id }, select: { totpEnabled: true } });
  res.json({ enabled: !!c?.totpEnabled });
});

// POST /api/client/auth/2fa/setup → generate a secret + otpauth URI (not yet enabled)
router.post('/2fa/setup', clientPortalAuth, async (req, res) => {
  try {
    const client = await prisma.client.findUnique({ where: { id: req.portalClient.id } });
    if (client.totpEnabled) return res.status(400).json({ error: '2FA уже включена. Сначала отключите её.' });
    const secret = authenticator.generateSecret();
    await prisma.client.update({ where: { id: client.id }, data: { totpSecret: secret, totpEnabled: false } });
    const otpauth = authenticator.keyuri(client.email || client.id, ISSUER, secret);
    res.json({ secret, otpauth });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/client/auth/2fa/enable { totp } → verify the first code and turn 2FA on
router.post('/2fa/enable', clientPortalAuth, async (req, res) => {
  try {
    const totp = String((req.body || {}).totp || '').replace(/\s/g, '');
    const client = await prisma.client.findUnique({ where: { id: req.portalClient.id } });
    if (!client.totpSecret) return res.status(400).json({ error: 'Сначала выполните настройку 2FA' });
    if (!authenticator.check(totp, client.totpSecret)) return res.status(400).json({ error: 'Неверный код, попробуйте ещё раз' });
    await prisma.client.update({ where: { id: client.id }, data: { totpEnabled: true } });
    res.json({ success: true, enabled: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/client/auth/2fa/disable { password, totp } → turn 2FA off
router.post('/2fa/disable', clientPortalAuth, async (req, res) => {
  try {
    const { password, totp } = req.body || {};
    const client = await prisma.client.findUnique({ where: { id: req.portalClient.id } });
    if (!client.totpEnabled) return res.json({ success: true, enabled: false });
    const pwOk = await bcrypt.compare(password || '', client.passwordHash || '');
    if (!pwOk) return res.status(400).json({ error: 'Пароль неверный' });
    if (!authenticator.check(String(totp || '').replace(/\s/g, ''), client.totpSecret)) return res.status(400).json({ error: 'Неверный код 2FA' });
    await prisma.client.update({ where: { id: client.id }, data: { totpEnabled: false, totpSecret: null } });
    res.json({ success: true, enabled: false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
