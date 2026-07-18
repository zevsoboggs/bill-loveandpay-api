import jwt from 'jsonwebtoken';
import config from '../config.js';

// Verify the admin JWT (Authorization: Bearer <token>) for the Refine panel API.
export function adminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });
  try {
    const payload = jwt.verify(token, config.jwt.secret);
    req.admin = payload; // { sub, email, role }
    next();
  } catch {
    return res.status(401).json({ error: 'Недействительный или истёкший токен' });
  }
}

// Restrict a route to certain admin roles.
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.admin || !roles.includes(req.admin.role)) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
    next();
  };
}
