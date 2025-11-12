'use strict';
const fs = require('fs');
const Matcher = require('./matcher');

function argv() {
   const a = {};
   const raw = process.argv.slice(2);
   for (let i = 0; i < raw.length; i++) {
      const v = raw[i];
      if (v.startsWith('--')) {
         const k = v.replace(/^--/, '');
         const n = raw[i + 1];
         if (n && !n.startsWith('--')) {
            a[k] = n;
            i++;
         } else a[k] = true;
      }
   }
   return a;
}

function detectDelimiter(sample) {
   if (!sample) return '\t';
   const tabs = (sample.match(/\t/g) || []).length;
   const commas = (sample.match(/,/g) || []).length;
   return tabs > commas ? '\t' : ',';
}

function parseSimpleCsv(filepath) {
   const raw = fs.readFileSync(filepath, 'utf8');
   const lines = raw.split(/\r?\n/);
   let headerIdx = 0;
   for (let i = 0; i < Math.min(12, lines.length); i++) {
      const l = (lines[i] || '').toLowerCase();
      if (l.includes('symbol') && l.includes('quantity')) {
         headerIdx = i;
         break;
      }
      if (l.includes('ticker') && l.includes('trade type')) {
         headerIdx = i;
         break;
      }
   }
   const headerLine = lines[headerIdx] || lines[0];
   const delim = detectDelimiter(headerLine);
   const headers = headerLine.split(delim).map(h => h.trim());
   const records = [];
   for (let i = headerIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line || !line.trim()) continue;
      const cols = line.split(delim).map(c => c.trim());
      const obj = {};
      for (let j = 0; j < headers.length && j < cols.length; j++) obj[headers[j]] = cols[j];
      records.push(obj);
   }
   return {
      raw: fs.readFileSync(filepath, 'utf8'),
      records
   };
}

(function main() {
   const args = argv();
   const tradesPath = args.trades || args.t;
   const standardPath = args.standard || args.s;
   const outPath = args.out || args.o || './output.txt';
   if (!tradesPath || !standardPath) {
      console.error('Usage: --trades path --standard path --out path');
      process.exit(1);
   }
   if (!fs.existsSync(tradesPath) || !fs.existsSync(standardPath)) {
      console.error('Input files missing');
      process.exit(1);
   }

   const tradesParsed = parseSimpleCsv(tradesPath);
   const trades = tradesParsed.records;
   const standards = parseSimpleCsv(standardPath).records;

   const acctLine = tradesParsed.raw.split(/\r?\n/).find(l => l && l.trim().length > 0) || '';
   const acct = (acctLine.split(/\s+/)[0] || '').slice(-4);

   const rows = Matcher.match(trades, standards);

   rows.sort((a, b) => {
      const d = a.tradeId.localeCompare(b.tradeId);
      return d !== 0 ? d : a.leg.localeCompare(b.leg);
   });

   const out = [];
   out.push(acct || '');
   out.push('');
   for (const r of rows) out.push([r.tradeId, r.leg, String(r.qty)].join('\t'));
   fs.writeFileSync(outPath, out.join('\n'), 'utf8');
   console.log('Wrote', outPath);
})();