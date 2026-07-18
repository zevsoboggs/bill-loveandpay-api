import cron from 'node-cron';
import { pollAll } from '../services/depositWatcher.js';

// Background jobs. Deposit watcher runs every minute.
export function startJobs() {
  cron.schedule('* * * * *', async () => {
    try { await pollAll(); } catch (e) { console.error('[jobs] depositWatcher:', e.message); }
  });
  console.log('[jobs] deposit watcher scheduled (every minute)');
}
