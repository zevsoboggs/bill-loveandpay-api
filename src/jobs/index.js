import cron from 'node-cron';
import prisma from '../db.js';
import { pollAll } from '../services/depositWatcher.js';

// Background jobs.
export function startJobs() {
  // Deposit watcher — every minute.
  cron.schedule('* * * * *', async () => {
    try { await pollAll(); } catch (e) { console.error('[jobs] depositWatcher:', e.message); }
  });
  // Prune API logs older than 30 days — daily at 03:15.
  cron.schedule('15 3 * * *', async () => {
    try {
      const cutoff = new Date(Date.now() - 30 * 86400 * 1000);
      const { count } = await prisma.apiRequestLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
      if (count) console.log(`[jobs] pruned ${count} old API logs`);
    } catch (e) { console.error('[jobs] log prune:', e.message); }
  });
  console.log('[jobs] deposit watcher (1m) + API-log prune (daily) scheduled');
}
