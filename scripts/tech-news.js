// Posts new Bangladesh IT headlines (from TechShohor's public RSS feed) to a
// Facebook Page: headline + short summary + credit + link to the original.
// It never copies full articles.
//
// TECH_POST_MODE:
//   dry     print what would be posted; change nothing (default if no creds)
//   draft   create UNPUBLISHED posts (published=false) for an admin to review
//   publish post publicly right away
//
// A state file remembers which articles were already handled. On the very
// first real run it only records what is currently in the feed (so we don't
// flood the page with old news); only articles that appear afterwards post.
const fs = require('fs');
const path = require('path');

const FEED_URL = process.env.TECH_FEED_URL || 'https://techshohor.com/feed';
const STATE_PATH = process.env.TECH_STATE_PATH || path.join(__dirname, '..', 'data', 'tech-news-state.json');
const SOURCE_NAME = 'TechShohor';
const GRAPH_VERSION = 'v21.0';
const MAX_PER_RUN = 5;
const MAX_AGE_DAYS = 3;
const MAX_SEEN = 300;
const SUMMARY_CHARS = 220;

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };
const decode = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);

const text = (xml) =>
  decode(xml.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? m[1] : '';
}

function summarize(raw) {
  let s = text(raw);
  s = s.replace(/^টেক শহর[^:।]{0,30}:\s*/, ''); // outlet byline
  s = s.replace(/^(?:[^\s:।]+\s){1,3}[^\s:।]+\s:\s+/, ''); // reporter byline: "name name : text"
  s = s.replace(/The post .* appeared first on .*$/i, '').replace(/Read more.*$/i, '').replace(/…\s*$/, '').trim();
  if (s.length <= SUMMARY_CHARS) return s;
  const cut = s.slice(0, SUMMARY_CHARS);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 80)).replace(/[,\s।:;-]+$/, '') + '…';
}

function parseFeed(xml) {
  return xml
    .split('<item>')
    .slice(1)
    .map((b) => ({
      id: text(tag(b, 'guid')) || text(tag(b, 'link')),
      title: text(tag(b, 'title')),
      link: text(tag(b, 'link')),
      date: new Date(text(tag(b, 'pubDate'))),
      summary: summarize(tag(b, 'description')),
    }))
    .filter((i) => i.id && i.title && i.link && !isNaN(i.date));
}

function buildMessage(it) {
  return [it.title, '', it.summary, '', `সূত্র: ${SOURCE_NAME}`].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function saveState(seen) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify({ updatedAt: new Date().toISOString(), seen: seen.slice(-MAX_SEEN) }, null, 2) + '\n');
}

async function fetchFeed() {
  let lastErr;
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await fetch(FEED_URL, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      console.warn(`feed attempt ${i}/3 failed: ${e.cause?.code || e.message}`);
      if (i < 3) await new Promise((r) => setTimeout(r, i * 4000));
    }
  }
  throw lastErr;
}

async function postToFacebook(it, mode) {
  const { FB_PAGE_ID, FB_PAGE_TOKEN } = process.env;
  const body = new URLSearchParams({ message: buildMessage(it), link: it.link, access_token: FB_PAGE_TOKEN });
  if (mode === 'draft') body.set('published', 'false');
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${FB_PAGE_ID}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Facebook ${res.status}: ${JSON.stringify(json.error || json)}`);
  return json.id;
}

async function main() {
  const items = parseFeed(await fetchFeed()).sort((a, b) => a.date - b.date);
  console.log(`Feed has ${items.length} items.`);

  const haveCreds = process.env.FB_PAGE_ID && process.env.FB_PAGE_TOKEN;
  let mode = (process.env.TECH_POST_MODE || 'draft').toLowerCase();
  if (!['dry', 'draft', 'publish'].includes(mode)) mode = 'dry';
  if (!haveCreds) mode = 'dry';

  const state = loadState();
  const seen = new Set(state ? state.seen : []);

  if (!state) {
    if (mode === 'dry') {
      console.log('No state yet. Dry run preview of the 2 newest items (a real run would only record the baseline):\n');
      items.slice(-2).forEach((it) => console.log(buildMessage(it) + `\n${it.link}\n---`));
      return;
    }
    saveState(items.map((i) => i.id));
    console.log(`First run: recorded ${items.length} existing items as already seen, posted nothing.`);
    return;
  }

  const fresh = items.filter((i) => !seen.has(i.id));
  const cutoff = Date.now() - MAX_AGE_DAYS * 864e5;
  const stale = fresh.filter((i) => i.date.getTime() < cutoff);
  const postable = fresh.filter((i) => i.date.getTime() >= cutoff).slice(0, MAX_PER_RUN);
  console.log(`New: ${fresh.length}, too old to post: ${stale.length}, posting now: ${postable.length} (mode=${mode}).`);

  const done = [...seen, ...stale.map((i) => i.id)];
  let failed = false;
  for (const it of postable) {
    if (mode === 'dry') {
      console.log('\n' + buildMessage(it) + `\n${it.link}\n---`);
      continue;
    }
    try {
      const id = await postToFacebook(it, mode);
      console.log(`${mode === 'draft' ? 'Drafted' : 'Posted'}: ${it.title.slice(0, 50)} -> ${id}`);
      done.push(it.id);
    } catch (e) {
      console.error('Failed:', it.title.slice(0, 50), '|', e.message);
      failed = true;
      break; // keep order; retry this and later items next run
    }
  }
  if (mode !== 'dry') saveState(done);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error('tech-news failed:', e.message);
  process.exit(1);
});
