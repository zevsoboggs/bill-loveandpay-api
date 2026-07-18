// Transactional balance mutations. Every change writes an immutable LedgerEntry.
import prisma from '../db.js';
import { toNum, round6, systemBalanceField, balanceTypeForSystem, balanceFieldFor } from './money.js';

// Credit a confirmed USDT deposit into the client's unallocated deposit pool.
export async function creditDeposit(clientId, amountUsdt, { refId, note } = {}) {
  const amt = round6(amountUsdt);
  return prisma.$transaction(async (tx) => {
    const client = await tx.client.update({
      where: { id: clientId },
      data: { depositBalance: { increment: amt } },
    });
    await tx.ledgerEntry.create({
      data: {
        clientId, kind: 'DEPOSIT', balanceType: 'DEPOSIT',
        amountUsdt: amt, balanceAfter: client.depositBalance, refId, note,
      },
    });
    return client;
  });
}

// Distribute (or claw back) between the deposit pool and a system balance.
// amount > 0: deposit → system. amount < 0: system → deposit.
export async function allocate(clientId, adminId, system, amount, note) {
  const amt = round6(amount);
  return prisma.$transaction(async (tx) => {
    const client = await tx.client.findUnique({ where: { id: clientId } });
    if (!client) throw new Error('Client not found');

    const field = systemBalanceField(system);
    const deposit = toNum(client.depositBalance);
    const sysBal = toNum(client[field]);

    if (amt > 0 && deposit < amt) throw Object.assign(new Error('Insufficient deposit balance'), { code: 'INSUFFICIENT_DEPOSIT' });
    if (amt < 0 && sysBal < -amt) throw Object.assign(new Error('Insufficient system balance'), { code: 'INSUFFICIENT_SYSTEM' });

    const updated = await tx.client.update({
      where: { id: clientId },
      data: {
        depositBalance: { decrement: amt },
        [field]: { increment: amt },
      },
    });

    const allocation = await tx.allocation.create({
      data: { clientId, adminId, system, amount: amt, balanceAfter: updated[field], note },
    });

    // Two ledger legs (deposit pool out, system in) for a full audit trail.
    await tx.ledgerEntry.create({
      data: {
        clientId, kind: 'ALLOCATION', balanceType: 'DEPOSIT',
        amountUsdt: round6(-amt), balanceAfter: updated.depositBalance, refId: allocation.id, note,
      },
    });
    await tx.ledgerEntry.create({
      data: {
        clientId, kind: 'ALLOCATION', balanceType: balanceTypeForSystem(system), system,
        amountUsdt: amt, balanceAfter: updated[field], refId: allocation.id, note,
      },
    });

    return { client: updated, allocation };
  });
}

// Atomically debit a system balance for a relayed payment. Throws INSUFFICIENT
// if the balance can't cover it (checked inside the transaction).
export async function chargeSystem(clientId, system, amountUsdt, { refId, note } = {}) {
  const amt = round6(amountUsdt);
  const field = systemBalanceField(system);
  return prisma.$transaction(async (tx) => {
    const client = await tx.client.findUnique({ where: { id: clientId } });
    if (!client) throw new Error('Client not found');
    if (toNum(client[field]) < amt) throw Object.assign(new Error('Insufficient balance'), { code: 'INSUFFICIENT_BALANCE' });

    const updated = await tx.client.update({
      where: { id: clientId },
      data: { [field]: { decrement: amt } },
    });
    await tx.ledgerEntry.create({
      data: {
        clientId, kind: 'PAYMENT', balanceType: balanceTypeForSystem(system), system,
        amountUsdt: round6(-amt), balanceAfter: updated[field], refId, note,
      },
    });
    return updated;
  });
}

// Manual balance correction by an admin (signed). Writes an ADJUSTMENT ledger
// entry. Blocks a correction that would drive the balance negative.
export async function adjustBalance(clientId, adminId, balanceType, amount, note) {
  const amt = round6(amount);
  const field = balanceFieldFor(balanceType);
  if (!field) throw Object.assign(new Error('Invalid balanceType'), { code: 'BAD_TYPE' });
  const system = balanceType === 'DEPOSIT' ? null : balanceType;
  return prisma.$transaction(async (tx) => {
    const client = await tx.client.findUnique({ where: { id: clientId } });
    if (!client) throw new Error('Client not found');
    if (toNum(client[field]) + amt < 0) throw Object.assign(new Error('Баланс не может стать отрицательным'), { code: 'NEGATIVE_BALANCE' });

    const updated = await tx.client.update({ where: { id: clientId }, data: { [field]: { increment: amt } } });
    await tx.ledgerEntry.create({
      data: { clientId, kind: 'ADJUSTMENT', balanceType, system, amountUsdt: amt, balanceAfter: updated[field], note },
    });
    return updated;
  });
}

// Refund a previously charged amount back to the system balance.
export async function refundSystem(clientId, system, amountUsdt, { refId, note } = {}) {
  const amt = round6(amountUsdt);
  const field = systemBalanceField(system);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.client.update({
      where: { id: clientId },
      data: { [field]: { increment: amt } },
    });
    await tx.ledgerEntry.create({
      data: {
        clientId, kind: 'REFUND', balanceType: balanceTypeForSystem(system), system,
        amountUsdt: amt, balanceAfter: updated[field], refId, note,
      },
    });
    return updated;
  });
}
