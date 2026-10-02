// Posts the day's biggest price movers to a Facebook Page via the Graph API.
//
// Needs FB_PAGE_ID and FB_PAGE_TOKEN in the environment. If either is missing,
// or FB_DRY_RUN=true, it only prints the post text and exits 0, so the
// workflow never fails just because Facebook isn't set up yet.
const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data.json');
const GRAPH_VERSION = 'v21.0';
const TOP_N = 3;

const toBn = (s) => String(s).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[+d]);
const fmtPct = (p) => toBn(Math.abs(p).toFixed(2));
const fmtRange = (it) => (it.lo === it.hi ? `৳${toBn(it.lo)}` : `৳${toBn(it.lo)}–${toBn(it.hi)}`);

function line(it, arrow) {
  return `• ${it.name} (${it.unit}): ${fmtRange(it)} ${arrow}${fmtPct(it.mPct)}%`;
}

function buildMessage(data) {
  // Only scraper-generated rows have a month-over-month % we can trust;
  // manual entries (e.g. LPG) carry null and are skipped by the filter.
  const movers = data.items.filter(
    (it) => /^item-\d+$/.test(it.id) && typeof it.mPct === 'number' && it.lo > 0
  );
  const up = movers.filter((it) => it.mPct > 0).sort((a, b) => b.mPct - a.mPct).slice(0, TOP_N);
  const down = movers.filter((it) => it.mPct < 0).sort((a, b) => a.mPct - b.mPct).slice(0, TOP_N);

  if (up.length === 0 && down.length === 0) return null;

  const parts = [`ঢাকার বাজারদর, ${data.date} (গত মাসের তুলনায়)`, ''];
  if (up.length) parts.push('সবচেয়ে বেশি বেড়েছে:', ...up.map((it) => line(it, '▲')), '');
  if (down.length) parts.push('সবচেয়ে বেশি কমেছে:', ...down.map((it) => line(it, '▼')), '');
  parts.push('উৎস: ট্রেডিং কর্পোরেশন অব বাংলাদেশ (TCB)');
  if (process.env.SITE_URL) parts.push(`সম্পূর্ণ তালিকা: ${process.env.SITE_URL}`);
  return parts.join('\n');
}

async function main() {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const message = buildMessage(data);
  if (!message) {
    console.log('No price movers to report, skipping post.');
    return;
  }

  const { FB_PAGE_ID, FB_PAGE_TOKEN, FB_DRY_RUN } = process.env;
  if (!FB_PAGE_ID || !FB_PAGE_TOKEN || FB_DRY_RUN === 'true') {
    console.log(FB_DRY_RUN === 'true' ? 'Dry run, not posting. Post would be:' : 'FB_PAGE_ID / FB_PAGE_TOKEN not set, not posting. Post would be:');
    console.log('\n' + message + '\n');
    return;
  }

  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${FB_PAGE_ID}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ message, access_token: FB_PAGE_TOKEN }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Never echo the token; Graph errors don't include it.
    console.error('Facebook post failed:', res.status, JSON.stringify(body.error || body));
    process.exit(1);
  }
  console.log('Posted to Facebook, post id:', body.id);
}

main().catch((e) => {
  console.error('post-facebook failed:', e.message);
  process.exit(1);
});
