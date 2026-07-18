// SBP (СБП via USDT) provider — tranzor. The platform's own account; the relay
// layer adds the reseller margin on top of these provider prices.
import axios from 'axios';
import config from '../config.js';

function client() {
  return axios.create({
    baseURL: config.sbp.baseUrl,
    timeout: 60000,
    headers: { 'X-API-Key': config.sbp.apiKey, 'Content-Type': 'application/json' },
  });
}

export async function getRate() {
  const { data } = await client().get('/rate');
  return data;
}

export async function convertRate(rubAmount) {
  const { data } = await client().get(`/rate/convert?rub=${rubAmount}`);
  return data;
}

export async function getBalance() {
  const { data } = await client().get('/payments/balance');
  return data;
}

// Parse a SBP QR link → { id, rubAmount, usdtAmount, depositAddress, paymentDetails }.
export async function createPayment(qrData) {
  const { data } = await client().post('/payments', { qrData });
  return data;
}

// Pay a SBP QR instantly from the platform's pre-funded float.
export async function quickPay(qrData) {
  const { data } = await client().post('/payments/quick', { qrData });
  return data;
}

export async function getPayment(paymentId) {
  const { data } = await client().get(`/payments/${paymentId}`);
  return data;
}

export async function listPayments(status, limit = 20) {
  const params = {};
  if (status) params.status = status;
  if (limit) params.limit = limit;
  const { data } = await client().get('/payments', { params });
  return data;
}

export default { getRate, convertRate, getBalance, createPayment, quickPay, getPayment, listPayments };
