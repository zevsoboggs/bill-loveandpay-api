import express from 'express';
import axios from 'axios';
import helmet from 'helmet';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import config from './config.js';
import prisma from './db.js';
import { openapiSpec } from './swagger.js';

import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin/index.js';
import clientRoutes from './routes/client/index.js';
import v1Routes from './routes/v1/index.js';
import { startJobs } from './jobs/index.js';

const app = express();
app.set('trust proxy', 1); // correct client IP behind a reverse proxy

// Security headers. Relax CSP so Swagger UI assets load.
app.use(helmet({ contentSecurityPolicy: false }));

// Header-based auth (JWT / API keys), no cookies. In production we restrict
// browser origins to the SPA domains; server-to-server relay calls (no Origin
// header) are always allowed. Empty allow-list → reflect any origin (dev).
const allowlist = config.allowedOrigins;
app.use(cors({
  origin(origin, cb) {
    if (!allowlist.length || !origin || allowlist.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  exposedHeaders: ['X-Total-Count'],
}));

app.use(express.json({ limit: '1mb' }));

// ─── Health ─────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, service: 'bill.loveandpay.io', time: new Date().toISOString() }));

// Diagnostic: report this server's outbound (egress) public IP. Use it to verify
// which IP third-party APIs (CryptoOffice) see — whitelist Railway's static
// outbound IPs (Settings → Networking → Enable Static IPs) there.
app.get('/api/diag/egress-ip', async (req, res) => {
  try {
    const { data } = await axios.get('https://api.ipify.org?format=json', { timeout: 8000 });
    res.json({ egressIp: data.ip, note: 'Whitelist ALL Railway static outbound IPs in the CryptoOffice API-key settings.' });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
app.get('/', (req, res) => res.json({ service: 'Love&Pay Billing API', docs: '/docs', health: '/health' }));

// ─── Swagger (public relay API docs) ─────────────────────────────────────────
app.get('/openapi.json', (req, res) => res.json(openapiSpec));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec, { customSiteTitle: 'Love&Pay Billing API' }));

// ─── Admin panel API (Refine) ────────────────────────────────────────────────
app.use('/api/admin/auth', authRoutes);
app.use('/api/admin', adminRoutes);

// ─── Client cabinet API ──────────────────────────────────────────────────────
app.use('/api/client', clientRoutes);

// ─── Public reseller relay API ───────────────────────────────────────────────
app.use('/v1', v1Routes);

// 404 + error handler
app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.originalUrl }));
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

const server = app.listen(config.port, () => {
  console.log(`\n🚀 Love&Pay Billing API on http://localhost:${config.port}`);
  console.log(`   Docs:   ${config.publicBaseUrl}/docs`);
  console.log(`   Admin:  ${config.adminOrigin}\n`);
  startJobs();
});

async function shutdown() {
  console.log('\nShutting down…');
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
