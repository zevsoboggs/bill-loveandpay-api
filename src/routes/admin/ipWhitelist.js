import { Router } from 'express';
import prisma from '../../db.js';
import { parseList, sendList } from '../../lib/refine.js';
import { serialize } from '../../lib/money.js';

const router = Router();

// GET /api/admin/ip-whitelist?clientId=...
router.get('/', async (req, res) => {
  try {
    const { skip, take, orderBy, where } = parseList(req.query, { allowedFilters: ['clientId', 'ip'] });
    const [rows, total] = await Promise.all([
      prisma.ipWhitelist.findMany({ skip, take, orderBy, where, include: { client: { select: { name: true } } } }),
      prisma.ipWhitelist.count({ where }),
    ]);
    sendList(res, serialize(rows), total);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', async (req, res) => {
  const row = await prisma.ipWhitelist.findUnique({ where: { id: req.params.id } });
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(serialize(row));
});

// POST /api/admin/ip-whitelist { clientId, ip, label }
router.post('/', async (req, res) => {
  try {
    const { clientId, ip, label } = req.body || {};
    if (!clientId || !ip) return res.status(400).json({ error: 'clientId и ip обязательны' });
    const row = await prisma.ipWhitelist.create({ data: { clientId, ip: String(ip).trim(), label: label || null } });
    res.status(201).json(serialize(row));
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'Этот IP уже в списке клиента' });
    res.status(500).json({ error: e.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { ip, label } = req.body || {};
    const data = {};
    if (ip !== undefined) data.ip = String(ip).trim();
    if (label !== undefined) data.label = label || null;
    const row = await prisma.ipWhitelist.update({ where: { id: req.params.id }, data });
    res.json(serialize(row));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await prisma.ipWhitelist.delete({ where: { id: req.params.id } });
    res.json({ id: req.params.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
