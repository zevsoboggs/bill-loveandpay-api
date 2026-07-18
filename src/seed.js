// Bootstrap the super-admin from env (idempotent). Run: npm run seed
import bcrypt from 'bcryptjs';
import prisma from './db.js';
import config from './config.js';

async function main() {
  const email = config.seedAdmin.email.toLowerCase();
  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    console.log(`[seed] admin already exists: ${email}`);
    return;
  }
  const passwordHash = await bcrypt.hash(config.seedAdmin.password, 10);
  await prisma.adminUser.create({
    data: { email, passwordHash, name: 'Super Admin', role: 'SUPERADMIN' },
  });
  console.log(`[seed] created super-admin: ${email}`);
  console.log(`[seed] password: ${config.seedAdmin.password}  (change it after first login)`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
