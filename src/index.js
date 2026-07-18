import express from 'express';
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
