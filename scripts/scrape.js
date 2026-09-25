// Daily DAM (Department of Agricultural Marketing) Dhaka retail price scraper.
//
// The DAM report's Bengali product names are encoded in a legacy non-Unicode
// font, so they extract garbled. We never try to read them. Instead we read
// the report as a fixed grid: every item row has exactly 11 fields
//   [curLo, "-", curHi, monthLo, "-", monthHi, monthPct, yearLo, "-", yearHi, yearPct]
// where a missing value prints as a literal "-" placeholder. We tokenize the
// page's plain text, keep only numbers and lone "-" tokens (dropping Bengali
// words), find where the real data starts, and slice it into 11-field rows
// mapped positionally onto FIXED_ITEM_IDS (the report's stable government
// item ordering).
//
// This is inherently a best-effort extraction against a document we don't
// control the formatting of. The GitHub Actions workflow that runs this
// script opens a Pull Request instead of pushing straight to main, and
// Vercel's PR preview lets a human glance at the rendered table before
// merging — that review step is the real safety net, not this script alone.
const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

const MARKETPRICE_URL = 'https://dam.gov.bd/pages/marketprice';
const DATA_PATH = path.join(__dirname, '..', 'data.json');
const FIELDS_PER_ROW = 11;

const FIXED_ITEM_IDS = [
  'ata-packet', 'ata-khola', 'moshur-unnoto', 'moshur-mota', 'mug-shoru',
  'mug-mota', 'kheshari', 'mashkolai', 'but', 'chola', 'soyabin-khola',
  'palm-khola', 'soyabin-1l', 'soyabin-5l', 'sorisha-khola', 'chini',
  'peyaj-deshi', 'rosun-deshi', 'rosun-amdani', 'ada', 'shukna-morich',
  'kacha-morich', 'alu', 'begun', 'kacha-pepe', 'misti-kumra', 'chichinga',
  'mukhikochu', 'borboti', 'lau', 'potol', 'dherosh', 'shosha', 'chalkumra',
  'korola', 'jhinga', 'dhundul', 'uste', 'kochurlati', 'rui', 'katol'
];

async function findLatestDhakaPdfUrl() {
  const res = await fetch(MARKETPRICE_URL);
  const html = await res.text();
  const matches = [...html.matchAll(/https:\/\/objectstorage[^"'\s]+\.pdf/g)].map(m => m[0]);
  if (matches.length === 0) throw new Error('No PDF links found on marketprice page — DAM may have changed their page structure.');
  return matches[0]; // first row = most recent report
}

function tokenizeToFields(text) {
  // Match numbers directly in the raw text (not by whitespace-splitting first):
  // a Bengali label sometimes has no space before the next number ("3.26প্র"),
  // which a naive split-then-match would silently drop and misalign every
  // row after it. The alternation's number branch is tried first, so it
  // consumes a leading "-" that belongs to a negative number before the
  // dash branch ever sees it — only genuinely standalone "-" placeholders
  // (missing data) fall through to become null.
  const fields = [];
  const re = /-?\d+\.\d{2}|-/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    fields.push(m[0] === '-' ? null : Number(m[0]));
  }
  return fields;
}

// The table header ("সর্বনিম্ন - সর্বোচ্চ" repeated) produces its own noise
// of numbers/dashes before the real rows start. Find the first plausible
// "price - price" ascending pair (both >= 10) as the anchor.
function findDataStart(fields) {
  for (let i = 0; i < fields.length - 2; i++) {
    if (typeof fields[i] === 'number' && fields[i + 1] === null && typeof fields[i + 2] === 'number'
        && fields[i] >= 10 && fields[i + 2] >= fields[i]) {
      return i;
    }
  }
  return -1;
}

function toBengaliDigits(s) {
  const map = ['০','১','২','৩','৪','৫','৬','৭','৮','৯'];
  return s.replace(/\d/g, d => map[+d]);
}

async function main() {
  console.log('Finding latest Dhaka retail PDF...');
  const pdfUrl = await findLatestDhakaPdfUrl();
  console.log('Found:', pdfUrl);

  const pdfRes = await fetch(pdfUrl);
  if (!pdfRes.ok) throw new Error(`Failed to download PDF: ${pdfRes.status}`);
  const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());

  const parser = new PDFParse({ data: new Uint8Array(pdfBuf) });
  const parsed = await parser.getText();
  const page1Text = parsed.pages[0]?.text || '';
  const page2Text = parsed.pages[1]?.text || '';

  const fields = tokenizeToFields(page2Text);
  const start = findDataStart(fields);
  if (start === -1) {
    console.error('SAFETY STOP: could not find the start of the price table (no ascending "num - num" pair found). Refusing to write.');
    process.exit(1);
  }

  const dataFields = fields.slice(start);
  const expectedFieldCount = FIXED_ITEM_IDS.length * FIELDS_PER_ROW;
  if (Math.abs(dataFields.length - expectedFieldCount) > FIELDS_PER_ROW * 3) {
    console.error(`SAFETY STOP: expected ~${expectedFieldCount} fields, found ${dataFields.length}. DAM's report layout may have changed. Refusing to write.`);
    process.exit(1);
  }

  const dateMatch = page1Text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  const reportDate = dateMatch ? `${toBengaliDigits(dateMatch[1])}-${toBengaliDigits(dateMatch[2])}-${toBengaliDigits(dateMatch[3])}` : null;

  const existing = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  if (reportDate && existing.date === reportDate) {
    console.log(`Report date ${reportDate} matches existing data — nothing to update.`);
    return;
  }

  const byId = Object.fromEntries(existing.items.map(it => [it.id, it]));
  let updated = 0;
  const flags = [];

  for (let idx = 0; idx < FIXED_ITEM_IDS.length; idx++) {
    const base = idx * FIELDS_PER_ROW;
    const row = dataFields.slice(base, base + FIELDS_PER_ROW);
    if (row.length < FIELDS_PER_ROW) break;
    const id = FIXED_ITEM_IDS[idx];
    const target = byId[id];
    if (!target) continue;

    const [curLo, , curHi, monLo, , monHi, monPct, yrLo, , yrHi, yrPct] = row;

    if (curLo == null || curHi == null || curHi < curLo) {
      flags.push(`${id}: current price range looks invalid (${curLo}-${curHi}) — left unchanged`);
      continue;
    }

    target.lo = curLo; target.hi = curHi;
    target.mLo = monLo; target.mHi = monHi; target.mPct = monPct;
    target.yLo = yrLo; target.yHi = yrHi; target.yPct = yrPct;
    updated++;
  }

  existing.date = reportDate || existing.date;
  existing.source = 'dam.gov.bd';
  existing.updatedAt = new Date().toISOString();

  fs.writeFileSync(DATA_PATH, JSON.stringify(existing, null, 2) + '\n');
  console.log(`Updated ${updated}/${FIXED_ITEM_IDS.length} items for report date ${existing.date}.`);
  if (flags.length) {
    console.log('Flagged rows (left unchanged, please double-check in the PR diff):');
    flags.forEach(f => console.log(' -', f));
  }
}

main().catch(e => {
  console.error('Scrape failed:', e);
  process.exit(1);
});
