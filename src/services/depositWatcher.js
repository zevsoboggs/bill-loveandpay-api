// Watches each client's CryptoOffice transit wallet and credits new USDT
// arrivals to their deposit balance. Uses a per-wallet baseline so re-polling
// the same on-chain balance never double-credits — no sweeping required.
import prisma from '../db.js';
import cryptoOffice from '../services/cryptoOffice.js';
import { creditDeposit } from '../lib/ledger.js';
import { toNum, round6 } from '../lib/money.js';

const DUST = 0.5; // ignore arrivals below this (USDT)

// Check one client's deposit wallet. Returns { credited, newBalance } or null.
export async function checkClient(clientId) {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client?.depositWalletId) return null;

  let onchain;
  try {
    onchain = await cryptoOffice.getWalletUsdt(client.depositWalletId);
  } catch (e) {
    console.error(`[depositWatcher] ${client.name}: wallet read failed —`, e.response?.status || e.message);
    return null;
  }

  const baseline = toNum(client.depositWalletBaseline);
  const delta = round6(onchain - baseline);

  if (delta >= DUST) {
    // New funds arrived → record + credit + advance baseline.
    const deposit = await prisma.deposit.create({
      data: {
        clientId: client.id, amountUsdt: delta, network: 'TRC-20',
        address: client.depositWalletAddress, status: 'CREDITED',
        note: 'Auto-detected on-chain deposit', confirmedAt: new Date(),
      },
    });
    await creditDeposit(client.id, delta, { refId: deposit.id, note: 'On-chain USDT deposit' });
    await prisma.client.update({ where: { id: client.id }, data: { depositWalletBaseline: round6(onchain) } });
    console.log(`[depositWatcher] ${client.name}: +${delta} USDT credited`);
    return { credited: delta, newBalance: onchain };
  }

  // Funds moved out (swept) → lower baseline so future arrivals credit correctly.
  if (onchain < baseline) {
    await prisma.client.update({ where: { id: client.id }, data: { depositWalletBaseline: round6(onchain) } });
  }
  return { credited: 0, newBalance: onchain };
}

// Poll every client that has a deposit wallet.
export async function pollAll() {
  const clients = await prisma.client.findMany({
    where: { depositWalletId: { not: null }, status: { not: 'SUSPENDED' } },
    select: { id: true },
  });
  for (const c of clients) {
    try { await checkClient(c.id); } catch (e) { console.error('[depositWatcher] poll error:', e.message); }
  }
}
