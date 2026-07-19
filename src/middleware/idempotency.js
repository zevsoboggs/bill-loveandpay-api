// Idempotent payment retries. When the client sends an `Idempotency-Key` header,
// the first request is processed and its response cached; identical retries replay
// the cached response instead of charging again. Optional — no header = normal.
import crypto from 'crypto';
import prisma from '../db.js';

export async function idempotency(req, res, next) {
  const key = req.headers['idempotency-key'];
  const clientId = req.client?.id || req.portalClient?.id;
  if (!key || !clientId) return next();

  const requestHash = crypto
    .createHash('sha256')
    .update(`${req.method}:${req.path}:${JSON.stringify(req.body || {})}`)
    .digest('hex');

  // Claim the key (unique per client). Race-safe via the DB unique constraint.
  let record;
  try {
    record = await prisma.idempotencyKey.create({
      data: { clientId, key: String(key), method: req.method, path: req.originalUrl, requestHash, status: 'PENDING' },
    });
  } catch (e) {
    if (e.code === 'P2002') {
      const existing = await prisma.idempotencyKey.findUnique({ where: { clientId_key: { clientId, key: String(key) } } });
      if (!existing) return next();
      if (existing.requestHash !== requestHash) {
        return res.status(422).json({ error: 'Idempotency-Key переиспользован с другим телом запроса', code: 'IDEMPOTENCY_MISMATCH' });
      }
      if (existing.status === 'PENDING') {
        return res.status(409).json({ error: 'Запрос с этим Idempotency-Key ещё обрабатывается', code: 'IDEMPOTENCY_IN_PROGRESS' });
      }
      res.set('Idempotency-Replayed', 'true');
      return res.status(existing.responseStatus || 200).json(existing.responseBody);
    }
    return next(e);
  }

  // Capture the response; cache business results, drop the key on server errors so
  // the client can retry.
  const origJson = res.json.bind(res);
  res.json = (body) => {
    const status = res.statusCode || 200;
    if (status >= 500) {
      prisma.idempotencyKey.delete({ where: { id: record.id } }).catch(() => {});
    } else {
      prisma.idempotencyKey.update({ where: { id: record.id }, data: { status: 'DONE', responseStatus: status, responseBody: body } }).catch(() => {});
    }
    return origJson(body);
  };
  next();
}
