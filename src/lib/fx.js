// EUR→USD (≈USDT) rate with a 1h in-memory cache and a config fallback.
import axios from 'axios';
import config from '../config.js';

let cache = { rate: null, at: 0 };
const TTL = 60 * 60 * 1000; // 1 hour

export async function eurToUsd() {
  const now = Date.now();
  if (cache.rate && now - cache.at < TTL) return cache.rate;
  try {
    const { data } = await axios.get('https://open.er-api.com/v6/latest/EUR', { timeout: 8000 });
    const rate = data?.rates?.USD;
    if (rate && rate > 0) {
      cache = { rate, at: now };
      return rate;
    }
  } catch {
    /* fall through to fallback */
  }
  return config.esim.eurUsdFallback;
}

// Convert an EUR amount to USDT (USDT pegged ~1:1 to USD).
export async function eurToUsdt(amountEur) {
  const rate = await eurToUsd();
  return Number(amountEur) * rate;
}
