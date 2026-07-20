// PaySpace VCC (virtual crypto cards) — app.pay.space. HMAC-signed requests.
// Used ONLY by the admin corporate-cards tool; never exposed on the relay/cabinet.
import crypto from 'crypto';
import config from '../config.js';

function sign(method, path, queryString, body) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(8).toString('hex');
  const bodyHash = crypto.createHash('sha256').update(body || '').digest('hex');
  const canonicalQuery = (queryString || '').split('&').filter(Boolean).sort().join('&');
  const message = `${method}\n${path}\n${canonicalQuery}\n${bodyHash}\n${timestamp}\n${nonce}`;
  const signature = crypto.createHmac('sha256', config.payspace.secret).update(message).digest('base64');
  return { 'X-Timestamp': timestamp, 'X-Nonce': nonce, 'X-Signature': signature };
}

async function request(method, path, query = {}, data = null) {
  const base = config.payspace.baseUrl.replace(/\/$/, '');
  const qs = Object.entries(query).map(([k, v]) => `${k}=${v}`).join('&');
  const fullUrl = qs ? `${base}${path}?${qs}` : `${base}${path}`;
  const body = data ? JSON.stringify(data) : '';
  const signHeaders = sign(method.toUpperCase(), path, qs, body);
  const headers = { Authorization: `Bearer ${config.payspace.apiKey}`, ...signHeaders };
  if (data) headers['Content-Type'] = 'application/json';

  const opts = { method, headers, signal: AbortSignal.timeout(30000) };
  if (data) opts.body = body;

  const resp = await fetch(fullUrl, opts);
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Pay.Space ${resp.status}: ${text.substring(0, 200)}`);
  try { return JSON.parse(text); } catch { return text; }
}

// Providers vary the case per product; normalize to expose BOTH snake & camel.
export function normalizeCard(d) {
  if (!d || typeof d !== 'object') return d;
  const cardId = d.card_id ?? d.cardId ?? d.CardId;
  const cardNo = d.card_no ?? d.cardNo ?? d.cardNumber;
  const cvv = d.cvv ?? d.CVV;
  const expDate = d.exp_date ?? d.expDate ?? d.expirationDate;
  const cardBal = d.card_bal ?? d.cardBal ?? d.CardBal ?? d.balance;
  const cardType = d.card_type ?? d.cardType ?? d.cardNetwork;
  const status = d.status ?? d.cardStatus;
  const productCode = d.product_code ?? d.productCode;
  return {
    ...d,
    card_id: cardId, card_no: cardNo, cvv, exp_date: expDate, card_bal: cardBal, card_type: cardType, status, product_code: productCode,
    cardId, cardNo, expDate, cardBal, cardType, productCode,
  };
}

export async function getCardInfo(cardId) {
  const r = await request('GET', '/api/v1/vcc/card/info/', { card_id: cardId });
  if (r && typeof r === 'object' && r.data) r.data = normalizeCard(r.data);
  return r;
}

export async function getCardTransactions(cardId, limit = 50, offset = 0) {
  return request('GET', '/api/v1/vcc/transactions/', { card_id: cardId, limit, offset });
}

export async function createCard(amount, programId, callbackUrl) {
  const r = await request('POST', '/api/v1/vcc/card/create/', {}, { amount, product_code: programId, callback_url: callbackUrl });
  if (r?.data?.card) r.data.card = normalizeCard(r.data.card);
  return r;
}

export async function topupCard(cardId, amount, requestId) {
  return request('POST', '/api/v1/vcc/card/topup/', {}, { card_id: cardId, amount, request_id: requestId });
}

export async function getBalance() {
  return request('GET', '/api/v1/vcc/user/balance/');
}

export async function updateCardEmail(cardId, email) {
  return request('POST', '/api/v1/vcc/card/update/', {}, { card_id: cardId, email });
}

export default { getCardInfo, getCardTransactions, createCard, topupCard, getBalance, updateCardEmail, normalizeCard };
