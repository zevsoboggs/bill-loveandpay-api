// CryptoOffice (Office API) client — deposit transit wallets + USDT ops.
// Auth: token = publicKey + "|" + xsalsa20(blake2b(secret), "<phrase>|<ts>").
import crypto from 'crypto';
import sodium from 'sodium-native';
import axios from 'axios';
import config from '../config.js';

const BASE = config.cryptoOffice.baseUrl;
const client = axios.create({ baseURL: BASE, timeout: 20000 });

function blake2bHash(input, digestSize) {
  const out = Buffer.alloc(digestSize);
  sodium.crypto_generichash(out, Buffer.from(input));
  return out;
}

function xsalsa20Encrypt(data, secretKey) {
  const keyBytes = blake2bHash(secretKey, 32);
  const nonce = Buffer.alloc(24);
  sodium.randombytes_buf(nonce);
  const dataBytes = Buffer.from(data, 'utf-8');
  const ciphertext = Buffer.alloc(dataBytes.length);
  sodium.crypto_stream_xor(ciphertext, dataBytes, nonce, keyBytes);
  return Buffer.concat([nonce, ciphertext]).toString('base64');
}

async function generateToken() {
  const { data: phraseResp } = await client.get('/api/get-phrase');
  const phrase = phraseResp.data.phrase;
  const timestamp = Math.floor(Date.now() / 1000);
  const encrypted = xsalsa20Encrypt(`${phrase}|${timestamp}`, config.cryptoOffice.secretKey);
  return `${config.cryptoOffice.publicKey}|${encrypted}`;
}

function authHeaders(token) {
  return { Authorization: `External ${token}`, Accept: 'application/json' };
}

async function getRequestHash(token) {
  try {
    const { data } = await client.post('api/auth/generate-request-hash', {}, { headers: authHeaders(token) });
    const hash = data?.data?.request_hash || data?.request_hash || '';
    if (hash) return hash;
  } catch (e) {
    console.error('[CryptoOffice] request-hash failed:', e.response?.status);
  }
  return `rh${Date.now()}${crypto.randomBytes(16).toString('hex')}`.substring(0, 34);
}

// Create a dedicated transit wallet (TRON/USDT TRC-20 by default) for a client.
export async function createWallet(label, blockchain = 'tron', paymentCoin = 1) {
  const token = await generateToken();
  const requestHash = await getRequestHash(token);
  const form = new URLSearchParams({ blockchain, label, payment_coin: String(paymentCoin), request_hash: requestHash });
  const { data } = await client.post('/api/v1/transit/store-one-wallet', form, { headers: authHeaders(token) });
  return { id: data.data.id, blockchain: data.data.blockchain, address: data.data.address };
}

// Read a transit wallet with parsed balances.
export async function getWallet(walletId) {
  const token = await generateToken();
  const { data } = await client.get(`/api/v1/transit/show-wallet?wallet_id=${walletId}`, { headers: authHeaders(token) });
  const d = data.data;
  const balances = [];
  if (d.balances) {
    for (const [key, val] of Object.entries(d.balances)) {
      balances.push({
        key, amount: Number(val.amount || 0), isUsdt: val.is_usdt || false,
        shortName: val.short_name || key, coin: val.coin || 0,
      });
    }
  }
  return { id: d.id, blockchain: d.blockchain, address: d.address, balances };
}

// Sum of USDT across a wallet's balances.
export async function getWalletUsdt(walletId) {
  const w = await getWallet(walletId);
  return w.balances.filter((b) => b.isUsdt).reduce((s, b) => s + b.amount, 0);
}

// Send coins from a transit wallet. sendCoin 1 = USDT TRC-20.
export async function sendMoney(walletId, sendCoin, address, amount) {
  const token = await generateToken();
  const requestHash = await getRequestHash(token);
  const form = new URLSearchParams({ send_coin: String(sendCoin), address, amount: String(amount), request_hash: requestHash });
  const { data } = await client.post(`/api/v1/transit/${walletId}/send-money`, form, { headers: authHeaders(token) });
  return data?.status || false;
}

// List the account's main wallets (per blockchain) with balances.
export async function listMainWallets(blockchain) {
  const token = await generateToken();
  const q = blockchain ? `?blockchains[0]=${blockchain}` : '';
  const { data } = await client.get(`/api/v1/wallets/list-main-wallets${q}`, { headers: authHeaders(token) });
  return data;
}

export default { createWallet, getWallet, getWalletUsdt, sendMoney, listMainWallets };
