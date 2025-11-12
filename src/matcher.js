'use strict';

function parseSymbolFromRaw(rawSymbol) {
   if (!rawSymbol || typeof rawSymbol !== 'string') return null;
   const s = rawSymbol.trim();
   const m = s.match(/([A-Z]+)\s+(\d{6,8})([CP])(\d+)$/i);
   if (!m) return null;
   const underlying = m[1];
   const expRaw = m[2];
   const cp = m[3];
   const strikeDigits = m[4];
   const strike = (strikeDigits.length >= 5) ? (parseInt(strikeDigits, 10) / 1000) : (parseInt(strikeDigits, 10) / 100);
   let expNorm = '';
   if (expRaw.length === 6) expNorm = expRaw.slice(2, 4) + '/' + expRaw.slice(4, 6) + '/20' + expRaw.slice(0, 2);
   else if (expRaw.length === 8) expNorm = expRaw.slice(4, 6) + '/' + expRaw.slice(6, 8) + '/' + expRaw.slice(0, 4);
   else expNorm = expRaw;
   return {
      underlying,
      expiry: expNorm,
      expiryDigits: expRaw,
      type: cp === 'C' ? 'C' : 'P',
      strike: Number(strike).toFixed(2)
   };
}

function normalizeDigits(v) {
   if (!v) return '';
   return v.toString().replace(/[^0-9]/g, '');
}

function normalizeFullExpiry(exp) {
   if (!exp) return '';
   const d = ('' + exp).replace(/[^0-9]/g, '');
   if (d.length === 6) return d.slice(0, 2) + '/' + d.slice(2, 4) + '/20' + d.slice(4, 6);
   if (d.length === 8) {
      if (d.slice(0, 4).startsWith('20')) return d.slice(4, 6) + '/' + d.slice(6, 8) + '/' + d.slice(0, 4);
      return d.slice(0, 2) + '/' + d.slice(2, 4) + '/' + d.slice(4, 8);
   }
   return exp;
}

function buildGroupedTrades(trades) {
   const map = new Map();
   for (const t of trades) {
      const sym = (t['Symbol'] || t['Symbol '] || t['symbol'] || '').toString();
      const qtyRaw = (t['Quantity'] || t['Quantity '] || t['Qty'] || t['qty'] || '0').toString();
      let q = qtyRaw.trim();
      if (q.startsWith('(') && q.endsWith(')')) q = '-' + q.slice(1, -1);
      q = q.replace(/[−–—]/g, '-');
      q = q.replace(/[^0-9\-\.]/g, '');
      const qty = Number(q) || 0;
      if (!sym || qty === 0) continue;
      const parsed = parseSymbolFromRaw(sym);
      let expiryDigits = '';
      let strike = '';
      let typ = '';
      let parsedExpiry = '';
      if (parsed) {
         expiryDigits = parsed.expiryDigits || '';
         strike = parsed.strike || '';
         typ = parsed.type || '';
         parsedExpiry = parsed.expiry || '';
      } else {
         expiryDigits = normalizeDigits(t['Acquired/Opened'] || t['Acquired Opened'] || t['Acquired'] || '');
         strike = (t['Strike'] || t['Strike '] || '') ? Number((t['Strike'] || t['Strike ']).toString().replace(/[^0-9\.]/g, '')).toFixed(2) : '';
         typ = ((t['Name'] || '').toString().toUpperCase().includes('PUT')) ? 'P' : (((t['Name'] || '').toString().toUpperCase().includes('CALL')) ? 'C' : '');
         parsedExpiry = t['Acquired/Opened'] || t['Acquired Opened'] || t['Acquired'] || '';
      }
      const underlying = (parsed ? parsed.underlying : (t['Symbol'] || '').toString().split(/\s+/)[0]).toUpperCase();
      const key = `${underlying}||${expiryDigits}||${strike}||${typ}`;
      if (!map.has(key)) map.set(key, {
         qty: 0,
         entries: []
      });
      const rec = map.get(key);
      rec.qty += qty;
      rec.entries.push({
         raw: t,
         parsedExpiry: parsedExpiry,
         strike: strike,
         qty: qty,
         type: typ
      });
   }
   return map;
}

function lookupGroupedQty(map, ticker, legExpiry, legStrike, inferredType) {
   const digits = normalizeDigits(normalizeFullExpiry(legExpiry));
   const strike = Number(legStrike || 0).toFixed(2);
   const candidates = [
      `${ticker.toUpperCase()}||${digits}||${strike}||${inferredType||''}`,
      `${ticker.toUpperCase()}||${digits}||${strike}||`,
      `${ticker.toUpperCase()}||${''}||${strike}||${inferredType||''}`,
      `${ticker.toUpperCase()}||${''}||${strike}||`
   ];
   for (const c of candidates) {
      if (map.has(c)) {
         const rec = map.get(c);
         const normalizedDigits = digits || normalizeDigits(legExpiry);
         let chosenExpiry = '';
         for (const e of rec.entries) {
            const ed = normalizeDigits(e.parsedExpiry || '');
            if (ed && (ed.endsWith(normalizedDigits) || normalizedDigits.endsWith(ed))) {
               chosenExpiry = e.parsedExpiry;
               break;
            }
         }
         if (!chosenExpiry && rec.entries.length > 0) chosenExpiry = rec.entries[0].parsedExpiry || '';
         return {
            qty: rec.qty,
            expiry: chosenExpiry
         };
      }
   }
   let s = 0;
   let firstExpiry = '';
   for (const [k, v] of map.entries()) {
      const parts = k.split('||');
      const tk = parts[0],
         st = parts[2];
      if (tk === ticker.toUpperCase() && st === strike) {
         s += v.qty;
         if (!firstExpiry && v.entries && v.entries.length > 0) firstExpiry = v.entries[0].parsedExpiry || firstExpiry;
      }
   }
   return {
      qty: s,
      expiry: firstExpiry
   };
}

function match(trades, standards) {
   const map = buildGroupedTrades(trades);
   const rows = [];
   for (const s of standards) {
      const tradeId = (s['Trade ID'] || s['TradeID'] || s['Trade Id'] || '').toString().trim();
      if (!tradeId) continue;
      const ticker = (s['Ticker'] || s['Symbol'] || '').toString().trim();
      const lt1 = (s['Leg1 Strike'] || s['Leg1  Strike'] || s['Leg1Strike'] || '').toString().replace(/[^0-9\.]/g, '');
      const le1 = (s['Leg1 Expiry'] || s['Leg1Expiry'] || s['Leg1  Expiry'] || '').toString().trim();
      const lt2 = (s['Leg2 Strike'] || s['Leg2Strike'] || '').toString().replace(/[^0-9\.]/g, '');
      const le2 = (s['Leg2 Expiry'] || s['Leg2Expiry'] || '').toString().trim();
      let inferred = '';
      const tt = (s['Trade Type'] || '').toString().toUpperCase();
      const tid = (s['Trade ID'] || s['TradeID'] || '').toString().toUpperCase();
      if (tt.includes('PUT') || tid.includes('CRDT') || tid.includes('PTSPRD') || tt.includes('CRDT')) inferred = 'P';
      else if (tt.includes('CALL') || tid.includes('DGLN') || tt.includes('DGLN')) inferred = 'C';
      else inferred = 'C';
      if (lt1 && le1) {
         const r1 = lookupGroupedQty(map, ticker, le1, lt1, inferred);
         const qty = r1.qty;
         const legExpiryOut = r1.expiry || normalizeFullExpiry(le1);
         rows.push({
            tradeId,
            leg: `${ticker} ${(legExpiryOut?normalizeFullExpiry(legExpiryOut):normalizeFullExpiry(le1))} ${Number(lt1).toFixed(2)} ${inferred||'C'}`,
            qty
         });
      }
      if (lt2 && le2) {
         const r2 = lookupGroupedQty(map, ticker, le2, lt2, inferred);
         const qty = r2.qty;
         const legExpiryOut = r2.expiry || normalizeFullExpiry(le2);
         rows.push({
            tradeId,
            leg: `${ticker} ${(legExpiryOut?normalizeFullExpiry(legExpiryOut):normalizeFullExpiry(le2))} ${Number(lt2).toFixed(2)} ${inferred||'C'}`,
            qty
         });
      }
   }
   return rows;
}

module.exports = {
   match
};