// Daily TCB (Trading Corporation of Bangladesh) Dhaka retail price scraper.
//
// We use TCB instead of DAM: TCB publishes a genuinely daily-updated Excel
// (.xlsx) file with clean, correctly-encoded Bengali text and real columns
// (name, unit, today's price, 1-week-ago, 1-month-ago, 1-year-ago, % change).
// DAM's PDF used a legacy font that garbled product names and required
// fragile positional guessing; TCB's spreadsheet needs none of that.
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { Agent } = require('undici');

const LISTING_URL = 'https://tcb.gov.bd/pages/daily-rmps';
const DATA_PATH = path.join(__dirname, '..', 'data.json');

// tcb.gov.bd (and dam.gov.bd — same government CMS platform) serve an
// incomplete certificate chain (missing intermediate CA), confirmed on
// GitHub's own Actions runners, not just a local network quirk. Scoped to
// just these requests, not process-wide, since it's a known-broken public
// government site and we're only reading public price data.
const insecureDispatcher = new Agent({ connect: { rejectUnauthorized: false } });
const fetchInsecure = (url) => fetch(url, { dispatcher: insecureDispatcher });

async function findLatestDetailPageUrl() {
  const res = await fetchInsecure(LISTING_URL);
  const html = await res.text();
  const match = html.match(/href="(\/pages\/daily-rmps\/[^"]+)"/);
  if (!match) throw new Error('No daily-rmps detail links found — TCB may have changed their page structure.');
  return 'https://tcb.gov.bd' + match[1];
}

async function findXlsxUrl(detailPageUrl) {
  const res = await fetchInsecure(detailPageUrl);
  const html = await res.text();
  const match = html.match(/https:\/\/objectstorage[^"'\s]+\.xlsx/);
  if (!match) throw new Error('No .xlsx file link found on the detail page — TCB may have changed their format.');
  return match[0];
}

function round2(n) {
  return typeof n === 'number' ? Math.round(n * 100) / 100 : n;
}

function extractItems(rows) {
  let cat = 'চাল'; // rows before the first category header are all rice varieties
  const items = [];
  for (let i = 8; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0] || !String(r[0]).trim()) continue;
    const name = String(r[0]).trim();
    // The sheet ends its real table here; what follows is a differently
    // shaped "what changed this week" summary we don't want to ingest.
    if (name.includes('যে সকল') || name.includes('জ্ঞাতার্থে')) break;

    if (typeof r[1] === 'string' && r[1].trim() && typeof r[2] === 'number') {
      items.push({
        cat, name, unit: r[1].trim(),
        lo: r[2], hi: r[3],
        mLo: r[6] ?? null, mHi: r[7] ?? null, mPct: round2(typeof r[8] === 'number' ? r[8] : null),
        yLo: r[9] ?? null, yHi: r[10] ?? null, yPct: round2(typeof r[11] === 'number' ? r[11] : null),
      });
    } else if (typeof r[2] !== 'number') {
      // A row with no price in this column is a category header, e.g. "ভোজ্য তেল".
      cat = name.replace(/[ঃ:]\s*$/, '').trim();
    }
  }
  return items;
}

function extractReportDate(rows) {
  // The sheet writes dates in Bengali numerals (২৫-০৯-২০২৬), not ASCII.
  for (const r of rows.slice(0, 8)) {
    const cell = (r || []).find(c => typeof c === 'string' && c.includes('তারিখঃ'));
    if (cell) {
      const m = cell.match(/([০-৯]{2})-([০-৯]{2})-([০-৯]{4})/);
      if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    }
  }
  return null;
}

function slugify(name, index) {
  // Names are Bengali; transliteration is unreliable, so id = stable index
  // into the *current* extraction order. Since we always fully replace the
  // items array together (not merge by id into an old list), a shifted
  // order across days doesn't cause stale cross-item mixing the way it
  // would if we merged field-by-field into pre-existing ids.
  return `item-${index + 1}`;
}

async function main() {
  console.log('Finding latest TCB daily report...');
  const detailUrl = await findLatestDetailPageUrl();
  console.log('Detail page:', detailUrl);

  const xlsxUrl = await findXlsxUrl(detailUrl);
  console.log('Excel file:', xlsxUrl);

  const res = await fetchInsecure(xlsxUrl);
  if (!res.ok) throw new Error(`Failed to download xlsx: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());

  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const items = extractItems(rows);
  if (items.length < 30) {
    console.error(`SAFETY STOP: only extracted ${items.length} items (expected 50+). TCB may have changed their spreadsheet layout. Refusing to write.`);
    process.exit(1);
  }

  const reportDate = extractReportDate(rows);
  const existing = fs.existsSync(DATA_PATH) ? JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')) : {};

  if (reportDate && existing.date === reportDate) {
    console.log(`Report date ${reportDate} matches existing data — nothing to update.`);
    return;
  }

  const withIds = items.map((it, i) => ({ id: slugify(it.name, i), ...it }));

  const out = {
    date: reportDate || existing.date || null,
    source: 'tcb.gov.bd',
    updatedAt: new Date().toISOString(),
    items: withIds,
  };

  fs.writeFileSync(DATA_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log(`Wrote ${withIds.length} items for report date ${out.date}.`);
}

main().catch(e => {
  console.error('Scrape failed:', e);
  process.exit(1);
});
