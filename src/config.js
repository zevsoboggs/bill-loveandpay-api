import dotenv from 'dotenv';
dotenv.config();

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

const config = {
  env: process.env.NODE_ENV || 'development',
  port: num(process.env.PORT, 4000),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:4000',
  adminOrigin: process.env.ADMIN_ORIGIN || 'http://localhost:5173',
  // Comma-separated browser origins allowed to call the admin/client APIs.
  // Empty → reflect any origin (dev). Set in production to the SPA domains.
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
    .split(',').map((s) => s.trim()).filter(Boolean),

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret',
    expiresIn: process.env.JWT_EXPIRES_IN || '12h',
  },

  seedAdmin: {
    email: process.env.SEED_ADMIN_EMAIL || 'admin@loveandpay.io',
    password: process.env.SEED_ADMIN_PASSWORD || 'Admin!ChangeMe2026',
  },

  cryptoOffice: {
    baseUrl: process.env.CRYPTO_OFFICE_BASE_URL || 'https://public.crypto-office.com',
    publicKey: process.env.CRYPTO_OFFICE_PUBLIC_KEY,
    secretKey: process.env.CRYPTO_OFFICE_SECRET_KEY,
    masterWalletAddress: process.env.MASTER_WALLET_ADDRESS,
    masterWalletId: num(process.env.MASTER_WALLET_ID, 0),
  },

  sbp: {
    baseUrl: process.env.SBP_API_BASE || 'https://sbpu.tranzor.io/api',
    apiKey: process.env.SBP_API_KEY,
    defaultMargin: num(process.env.DEFAULT_SBP_MARGIN, 0.04),
  },

  promptpay: {
    baseUrl: process.env.PROMPTPAY_API_BASE || 'https://promptpay.tranzor.io/api/v1',
    apiKey: process.env.PROMPTPAY_API_KEY,
    defaultMargin: num(process.env.DEFAULT_PROMPTPAY_MARGIN, 0.04),
  },

  esim: {
    baseUrl: process.env.YESIM_API_BASE || 'https://partners-api.yesim.biz',
    token: process.env.YESIM_API_TOKEN,
    defaultMargin: num(process.env.DEFAULT_ESIM_MARGIN, 0.15),
    // EUR→USDT fallback if the live FX lookup fails.
    eurUsdFallback: num(process.env.EUR_USD_FALLBACK, 1.08),
  },

  // Minimum deposit (USDT). eSIM-only partners get the lower threshold.
  deposits: {
    min: num(process.env.MIN_DEPOSIT_USDT, 1000),
    minEsim: num(process.env.MIN_DEPOSIT_ESIM_USDT, 200),
  },
};

export default config;
