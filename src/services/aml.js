// Love&Pay AML provider client (loveandpay-aml.fly.dev). Checks TRON / Ethereum /
// Bitcoin addresses and returns a risk report + branded PDF. Auth via X-API-Key.
// The provider quota (checks_remaining) is OUR prepaid cost; per-partner billing
// is handled in lib/amlBilling.js.
import axios from 'axios';
import config from '../config.js';

const base = () => config.aml.baseUrl.replace(/\/$/, '');
const headers = () => ({ 'X-API-Key': config.aml.apiKey, 'Content-Type': 'application/json' });

// POST /api/aml/check — network auto-detected from the address shape.
export async function checkAddress(address) {
  const { data } = await axios.post(`${base()}/api/aml/check`, { address }, { headers: headers(), timeout: 30000 });
  return data;
}

// GET /api/aml/report — PDF report bytes for an address.
export async function getReportPdf(address) {
  const { data } = await axios.get(`${base()}/api/aml/report`, {
    headers: { 'X-API-Key': config.aml.apiKey },
    params: { address },
    responseType: 'arraybuffer',
    timeout: 45000,
  });
  return Buffer.from(data);
}

// GET /api/quota — remaining checks on OUR provider key (admin monitoring).
export async function providerQuota() {
  const { data } = await axios.get(`${base()}/api/quota`, { headers: headers(), timeout: 10000 });
  return data;
}

export default { checkAddress, getReportPdf, providerQuota };
