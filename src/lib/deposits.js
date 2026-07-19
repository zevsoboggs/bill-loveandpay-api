import config from '../config.js';

// Effective minimum deposit (USDT) for a client. eSIM-only partners (eSIM enabled,
// no SBP/PromptPay) use the lower eSIM threshold; everyone else the default.
export function minDepositFor(client) {
  const esimOnly = client.esimEnabled && !client.sbpEnabled && !client.promptpayEnabled;
  return esimOnly ? config.deposits.minEsim : config.deposits.min;
}
