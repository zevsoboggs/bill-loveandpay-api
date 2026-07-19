import config from '../config.js';
import { toNum, round6 } from './money.js';

// Effective margin (fraction) for a client on a given service.
export function marginFor(client, system) {
  if (system === 'SBP') {
    return client.sbpMargin != null ? toNum(client.sbpMargin) : config.sbp.defaultMargin;
  }
  if (system === 'ESIM') {
    return client.esimMargin != null ? toNum(client.esimMargin) : config.esim.defaultMargin;
  }
  if (system === 'VPN') {
    return client.vpnMargin != null ? toNum(client.vpnMargin) : config.vpn.defaultMargin;
  }
  if (system === 'AML') {
    return client.amlMargin != null ? toNum(client.amlMargin) : config.aml.defaultMargin;
  }
  return client.promptpayMargin != null ? toNum(client.promptpayMargin) : config.promptpay.defaultMargin;
}

// Given provider cost in USDT, return the client-facing price breakdown.
export function priceFromCost(client, system, providerCostUsdt) {
  const cost = round6(providerCostUsdt);
  const margin = marginFor(client, system);
  const charged = round6(cost * (1 + margin));
  const profit = round6(charged - cost);
  return { providerCostUsdt: cost, marginRate: margin, chargedUsdt: charged, marginUsdt: profit };
}
