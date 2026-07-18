import jwt from 'jsonwebtoken';
import prisma from '../db.js';
import config from '../config.js';

// Verify the client-portal JWT (Authorization: Bearer) and load the client.
// Distinct from the relay API auth (which uses X-API-Key/Secret) and from the
// admin JWT (payload.type === 'admin').
export async function clientPortalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });
  try {
    const payload = jwt.verify(token, config.jwt.secret);
    if (payload.type !== 'client') return res.status(401).json({ error: 'Недействительный токен' });
    const client = await prisma.client.findUnique({ where: { id: payload.sub } });
    if (!client || client.status === 'SUSPENDED' || !client.portalEnabled) {
      return res.status(403).json({ error: 'Доступ к кабинету отключён' });
    }
    req.portalClient = client;
    next();
  } catch {
    return res.status(401).json({ error: 'Недействительный или истёкший токен' });
  }
}
