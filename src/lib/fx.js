// EUR→USDT rate from Binance (official market price of the EURUSDT pair), cached
// 10 min, with a mirror host and a config fallback.
import axios from 'axios';
import config from '../config.js';

let cache = { rate: null, at: 0 };
const TTL = 10 * 60 * 1000; // 10 minutes

const HOSTS = [
  'https://api.binance.com/api/v3/ticker/price?symbol=EURUSDT',
  'https://data-api.binance.vision/api/v3/ticker/price?symbol=EURUSDT',
];

// USDT per 1 EUR.
export async function eurToUsd() {
  const now = Date.now();
  if (cache.rate && now - cache.at < TTL) return cache.rate;

  for (const url of HOSTS) {
    try {
      const { data } = await axios.get(url, { timeout: 8000 });
      const rate = Number(data?.price);
      if (rate && rate > 0) {
        cache = { rate, at: now };
        return rate;
      }
    } catch {
      /* try next host */
    }
  }
  // Last-resort fallback (keeps pricing working if Binance is unreachable).
  return config.esim.eurUsdFallback;
}

// Convert an EUR amount to USDT.
export async function eurToUsdt(amountEur) {
  const rate = await eurToUsd();
  return Number(amountEur) * rate;
}
