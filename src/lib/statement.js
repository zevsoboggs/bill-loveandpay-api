// Monthly partner statement (PDF, Cyrillic via bundled DejaVuSans).
import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'url';
import { toNum } from './money.js';

const FONT = fileURLToPath(new URL('../../assets/fonts/DejaVuSans.ttf', import.meta.url));
const PRIMARY = '#0F4C5C';
const SYS_LABEL = { SBP: 'СБП (USDT)', PROMPTPAY: 'PromptPay', ESIM: 'eSIM', VPN: 'VPN' };
const money = (n) => `${toNum(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;

// data: { from, to, monthLabel, deposits:{count,sum}, bySystem:[{system,count,spent,margin}],
//         balances:{deposit,sbp,promptpay,esim,vpn}, includeProfit }
export function generateStatement(client, data) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 44, size: 'A4' });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.registerFont('body', FONT);
      doc.font('body');

      // Header
      doc.fontSize(22).fillColor(PRIMARY).text('Love&Pay', { continued: true }).fillColor('#888').fontSize(12).text('  ·  Выписка партнёра');
      doc.moveDown(0.3).fillColor('#000').fontSize(11);
      doc.text(`Партнёр: ${client.name}${client.email ? ' (' + client.email + ')' : ''}`);
      doc.text(`Период: ${data.monthLabel}  (${new Date(data.from).toLocaleDateString('ru-RU')} — ${new Date(data.to).toLocaleDateString('ru-RU')})`);
      doc.text(`Сформировано: ${new Date().toLocaleString('ru-RU')}`);
      doc.moveTo(44, doc.y + 6).lineTo(551, doc.y + 6).strokeColor('#e0e0e0').stroke();
      doc.moveDown(1);

      // Balances
      doc.fontSize(13).fillColor(PRIMARY).text('Текущие балансы');
      doc.fillColor('#000').fontSize(10.5).moveDown(0.3);
      const b = data.balances;
      doc.text(`Депозит: ${money(b.deposit)}    СБП: ${money(b.sbp)}    PromptPay: ${money(b.promptpay)}    eSIM: ${money(b.esim)}    VPN: ${money(b.vpn)}`);
      doc.moveDown(1);

      // Deposits
      doc.fontSize(13).fillColor(PRIMARY).text('Пополнения за период');
      doc.fillColor('#000').fontSize(10.5).moveDown(0.3);
      doc.text(`Кол-во: ${data.deposits.count}    Сумма: ${money(data.deposits.sum)}`);
      doc.moveDown(1);

      // Transactions by service — table
      doc.fontSize(13).fillColor(PRIMARY).text('Операции по услугам');
      doc.moveDown(0.4);
      const cols = data.includeProfit ? [44, 230, 320, 420] : [44, 260, 400];
      const headers = data.includeProfit ? ['Услуга', 'Операций', 'Оборот', 'Прибыль'] : ['Услуга', 'Операций', 'Потрачено'];
      doc.fontSize(10).fillColor('#666');
      headers.forEach((h, i) => doc.text(h, cols[i], doc.y, { continued: i < headers.length - 1, width: 120 }));
      doc.moveDown(0.4).fillColor('#000').fontSize(10.5);
      let totSpent = 0, totMargin = 0, totCount = 0;
      for (const r of data.bySystem) {
        const y = doc.y;
        doc.text(SYS_LABEL[r.system] || r.system, cols[0], y, { width: 150 });
        doc.text(String(r.count), cols[1], y, { width: 80 });
        doc.text(money(r.spent), cols[2], y, { width: 100 });
        if (data.includeProfit) doc.text(money(r.margin), cols[3], y, { width: 100 });
        totSpent += toNum(r.spent); totMargin += toNum(r.margin); totCount += r.count;
        doc.moveDown(0.2);
      }
      doc.moveDown(0.3).moveTo(44, doc.y).lineTo(551, doc.y).strokeColor('#e0e0e0').stroke().moveDown(0.3);
      const yt = doc.y;
      doc.fontSize(11).fillColor(PRIMARY);
      doc.text('Итого', cols[0], yt, { width: 150 });
      doc.text(String(totCount), cols[1], yt, { width: 80 });
      doc.text(money(totSpent), cols[2], yt, { width: 100 });
      if (data.includeProfit) doc.text(money(totMargin), cols[3], yt, { width: 100 });

      // Footer
      doc.fontSize(8.5).fillColor('#999').text('Love&Pay — платёжная инфраструктура для бизнеса. bill.loveandpay.io', 44, 790, { align: 'center', width: 507 });
      doc.end();
    } catch (e) { reject(e); }
  });
}
