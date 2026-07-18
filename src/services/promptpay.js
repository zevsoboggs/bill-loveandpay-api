// PromptPay (Thai QR) provider — tranzor. Platform account; relay adds margin.
// Note: this provider's JSON uses Russian keys (сумма_thb, данные, чек ...).
import axios from 'axios';
import config from '../config.js';

function client() {
  return axios.create({
    baseURL: config.promptpay.baseUrl,
    timeout: 60000,
    headers: { 'X-API-Key': config.promptpay.apiKey, 'Content-Type': 'application/json' },
  });
}

export async function getRate() {
  const { data } = await client().get('/rate');
  return data;
}

export async function scanQr(qrData) {
  const { data } = await client().post('/qr/scan', { qr_data: qrData });
  return data;
}

export async function calculate(amountThb) {
  const body = JSON.stringify({ 'сумма_thb': amountThb });
  const { data } = await client().post('/payment/calculate', body);
  return data;
}

// Pay a THB QR (wait=0 → async; poll receipt afterwards).
export async function payQrAsync(qr, amount, currency = 'THB') {
  const { data } = await client().post('/pay-qr?wait=0', { qr, amount, currency });
  return data;
}

export async function payQr(qr, amount, currency = 'THB') {
  const { data } = await client().post('/pay-qr', { qr, amount, currency });
  return data;
}

export async function getReceipt(id) {
  const { data } = await client().get(`/transactions/${id}/receipt`);
  return data;
}

export async function getSlip(id) {
  const resp = await client().get(`/transactions/${id}/slip`, { responseType: 'arraybuffer' });
  return Buffer.from(resp.data);
}

export async function getAccount() {
  const { data } = await client().get('/account');
  return data;
}

export async function getTransactions(limit = 20) {
  const { data } = await client().get(`/transactions?limit=${limit}`);
  return data;
}

export default { getRate, scanQr, calculate, payQrAsync, payQr, getReceipt, getSlip, getAccount, getTransactions };
