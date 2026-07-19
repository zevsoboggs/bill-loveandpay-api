// Logs each relay API request AFTER the response completes, capturing status +
// duration. Requires req.client (set by clientAuth). Fire-and-forget; never blocks.
import prisma from '../db.js';

export function apiLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const clientId = req.client?.id;
    if (!clientId) return;
    prisma.apiRequestLog
      .create({
        data: {
          clientId, method: req.method, path: req.originalUrl,
          ip: req.clientIp || null, status: res.statusCode,
          durationMs: Date.now() - start, sandbox: !!req.sandbox,
        },
      })
      .catch(() => {});
  });
  next();
}
