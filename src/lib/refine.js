// Translate Refine's @refinedev/simple-rest query params into Prisma args and
// set the X-Total-Count header Refine's list hooks rely on.
//
// Pagination: _start / _end (falls back to _page / _limit)
// Sorting:    _sort / _order
// Filters:    field=value, field_like, field_gte, field_lte, field_ne, field_in

const OPS = ['_like', '_gte', '_lte', '_gt', '_lt', '_ne', '_in'];
const RESERVED = new Set(['_start', '_end', '_sort', '_order', '_page', '_limit']);

export function parseList(query, { allowedFilters = [], numericFields = [] } = {}) {
  // Pagination
  let skip = 0;
  let take = 25;
  if (query._start !== undefined || query._end !== undefined) {
    skip = parseInt(query._start ?? 0, 10) || 0;
    const end = parseInt(query._end ?? skip + take, 10);
    take = Math.max(0, end - skip);
  } else if (query._page !== undefined || query._limit !== undefined) {
    const page = parseInt(query._page ?? 1, 10) || 1;
    take = parseInt(query._limit ?? take, 10) || take;
    skip = (page - 1) * take;
  }

  // Sorting (supports comma-separated multi-sort)
  let orderBy;
  if (query._sort) {
    const fields = String(query._sort).split(',');
    const orders = String(query._order || 'asc').split(',');
    orderBy = fields.map((f, i) => ({ [f]: (orders[i] || orders[0] || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc' }));
  } else {
    orderBy = { createdAt: 'desc' };
  }

  // Filters
  const where = {};
  for (const [rawKey, rawVal] of Object.entries(query)) {
    if (RESERVED.has(rawKey) || rawVal === undefined || rawVal === '') continue;

    const op = OPS.find((o) => rawKey.endsWith(o));
    const field = op ? rawKey.slice(0, -op.length) : rawKey;
    if (allowedFilters.length && !allowedFilters.includes(field)) continue;

    const cast = (v) => (numericFields.includes(field) ? Number(v) : v);

    if (!op) {
      where[field] = cast(rawVal);
    } else if (op === '_like') {
      where[field] = { contains: String(rawVal), mode: 'insensitive' };
    } else if (op === '_gte') {
      where[field] = { ...(where[field] || {}), gte: cast(rawVal) };
    } else if (op === '_lte') {
      where[field] = { ...(where[field] || {}), lte: cast(rawVal) };
    } else if (op === '_gt') {
      where[field] = { ...(where[field] || {}), gt: cast(rawVal) };
    } else if (op === '_lt') {
      where[field] = { ...(where[field] || {}), lt: cast(rawVal) };
    } else if (op === '_ne') {
      where[field] = { not: cast(rawVal) };
    } else if (op === '_in') {
      where[field] = { in: String(rawVal).split(',').map(cast) };
    }
  }

  return { skip, take, orderBy, where };
}

// Send a list response with the total-count header Refine reads.
export function sendList(res, rows, total) {
  res.set('X-Total-Count', String(total));
  res.set('Access-Control-Expose-Headers', 'X-Total-Count');
  res.json(rows);
}
