// Gate a relay sub-API behind the client's per-service access flag.
const FIELD = { SBP: 'sbpEnabled', PROMPTPAY: 'promptpayEnabled', ESIM: 'esimEnabled' };

export const requireService = (system) => (req, res, next) => {
  if (!req.client?.[FIELD[system]]) {
    return res.status(403).json({ error: `Услуга ${system} не подключена для этого партнёра`, code: 'SERVICE_DISABLED' });
  }
  next();
};
