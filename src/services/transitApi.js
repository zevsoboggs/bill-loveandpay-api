// Client for the external transit-wallet API (lnpapp transit-api). Auth via
// x-api-key header. Create/manage transit crypto wallets across TRON/BSC/ETH/BTC.
import axios from 'axios';
import config from '../config.js';

function client() {
  return axios.create({
    baseURL: config.transit.baseUrl,
    timeout: 30000,
    headers: { 'x-api-key': config.transit.apiKey, 'Content-Type': 'application/json' },
  });
}

export const networks = async () => (await client().get('/networks')).data;
export const master = async () => (await client().get('/master')).data;

// project/label optional; balances=1 to include live balances in a list.
export const listWallets = async ({ project, balances } = {}) => {
  const params = {};
  if (project) params.project = project;
  if (balances) params.balances = 1;
  return (await client().get('/wallets', { params })).data;
};
export const getWallet = async (id) => (await client().get(`/wallets/${id}`)).data;
export const walletBalance = async (id) => (await client().get(`/wallets/${id}/balance`)).data;

export const createWallet = async ({ network, label, project }) =>
  (await client().post('/wallets', { network, label, project })).data;

export const topup = async (id, { amount, coin }) =>
  (await client().post(`/wallets/${id}/topup`, { amount, ...(coin != null ? { coin } : {}) })).data;

export const transfer = async (id, { coin, toAddress, amount }) =>
  (await client().post(`/wallets/${id}/transfer`, { coin, toAddress, amount })).data;

export const rename = async (id, { label }) =>
  (await client().post(`/wallets/${id}/rename`, { label })).data;

export default { networks, master, listWallets, getWallet, walletBalance, createWallet, topup, transfer, rename };
