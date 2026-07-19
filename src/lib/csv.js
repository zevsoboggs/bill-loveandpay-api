// Minimal CSV serializer (RFC-4180 quoting).
const esc = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export function toCsv(rows, columns) {
  const header = columns.map((c) => esc(c.label)).join(',');
  const lines = rows.map((r) => columns.map((c) => esc(typeof c.value === 'function' ? c.value(r) : r[c.value])).join(','));
  return '﻿' + [header, ...lines].join('\r\n'); // BOM for Excel UTF-8
}

export const txColumns = [
  { label: 'Дата', value: (t) => new Date(t.createdAt).toISOString() },
  { label: 'Система', value: 'system' },
  { label: 'Статус', value: 'status' },
  { label: 'Сумма источника', value: (t) => (t.sourceAmount != null ? Number(t.sourceAmount) : '') },
  { label: 'Валюта', value: 'sourceCurrency' },
  { label: 'Себестоимость USDT', value: (t) => Number(t.providerCostUsdt) },
  { label: 'Наценка USDT', value: (t) => Number(t.marginUsdt) },
  { label: 'Списано USDT', value: (t) => Number(t.chargedUsdt) },
  { label: 'Ref', value: 'providerRef' },
  { label: 'Описание', value: 'description' },
];
