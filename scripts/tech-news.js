// Posts new Bangladesh tech headlines (from public RSS feeds) to a Facebook
// Page: original English headline + short excerpt + credit + link to the
// original article. It never copies full articles and never translates.
//
// TECH_POST_MODE:
//   dry     print what would be posted; change nothing (default if no creds)
//   draft   create UNPUBLISHED posts (published=false) for an admin to review
//   publish post publicly right away
//
// A state file remembers which articles were already handled. The first time
// a source is seen it is only recorded (baseline), so old articles are never
// flooded onto the page; only articles that appear afterwards get posted.
const fs = require('fs');
const path = require('path');

// `only`: if set, an article from that source is posted only when its title or
// excerpt matches (the feed is global, we want just the Bangladesh angle).
const SOURCES = [
  { name: 'The Daily Star', url: 'https://www.thedailystar.net/tech-startup/rss.xml' },
  { name: 'The Business Standard', url: 'https://www.tbsnews.net/tech/rss.xml' },
  { name: 'Rest of World', url: 'https://restofworld.org/feed/', only: /bangladesh|dhaka|south asia/i },
];

const STATE_PATH = process.env.TECH_STATE_PATH || path.join(__dirname, '..', 'data', 'tech-news-state.json');
const GRAPH_VERSION = 'v21.0';
const MAX_PER_RUN = 5;
const MAX_AGE_DAYS = 3;
const MAX_SEEN = 400;
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
  const m = block.match(new RegExp(`<${name}[^>]*>([^]*?)</${name}>`));
  return m ? m[1] : '';
}

function summarize(raw) {
  let s = text(raw);
  s = s.replace(/The post .* appeared first on .*$/i, '').replace(/(Read more|Continue reading).*$/i, '').replace(/…\s*$/, '').trim();
  if (s.length <= SUMMARY_CHARS) return s;
  const cut = s.slice(0, SUMMARY_CHARS);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 80)).replace(/[,\s।:;-]+$/, '') + '…';
}

function parseFeed(xml, source) {
  return xml
    .split(/<item[ >]/)
    .slice(1)
    .map((b) => {
      const link = text(tag(b, 'link'));
      return {
        source: source.name,
        id: `${source.name}|${text(tag(b, 'guid')) || link}`,
        title: text(tag(b, 'title')),
        link,
        date: new Date(text(tag(b, 'pubDate'))),
        summary: summarize(tag(b, 'description')),
      };
    })
    .filter((i) => i.title && i.link && !isNaN(i.date))
    .filter((i) => !source.only || source.only.test(`${i.title} ${i.summary}`));
}

function buildMessage(it) {
  return [it.title, '', it.summary, '', `সূত্র: ${it.source}`].filter((l, i, a) => !(l === '' && (i === 2 || a[i - 1] === ''))).join('\n');
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function saveState(seen, sources) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(
    STATE_PATH,
    JSON.stringify({ updatedAt: new Date().toISOString(), sources, seen: seen.slice(-MAX_SEEN) }, null, 2) + '\n'
  );
}

async function fetchText(url) {
  let lastErr;
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      console.warn(`  attempt ${i}/3 failed for ${url}: ${e.cause?.code || e.message}`);
      if (i < 3) await new Promise((r) => setTimeout(r, i * 3000));
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
  const fetched = {}; // source name -> items, only for sources that loaded
  for (const src of SOURCES) {
    try {
      fetched[src.name] = parseFeed(await fetchText(src.url), src);
      console.log(`${src.name}: ${fetched[src.name].length} usable items`);
    } catch (e) {
      console.warn(`${src.name}: FAILED (${e.message}), skipping this run`);
    }
  }
  if (Object.keys(fetched).length === 0) throw new Error('every source failed');

  const haveCreds = process.env.FB_PAGE_ID && process.env.FB_PAGE_TOKEN;
  let mode = (process.env.TECH_POST_MODE || 'draft').toLowerCase();
  if (!['dry', 'draft', 'publish'].includes(mode)) mode = 'dry';
  if (!haveCreds) mode = 'dry';

  const state = loadState();
  const seen = new Set(state ? state.seen : []);
  const knownSources = new Set(state ? state.sources || [] : []);

  const all = Object.values(fetched).flat().sort((a, b) => a.date - b.date);
  const newSources = Object.keys(fetched).filter((n) => !knownSources.has(n));

  // One-off: post the N newest articles right now instead of only baselining
  // (TECH_BACKFILL=N). Everything else currently in the feeds is still marked
  // as seen, so later runs only post what appears afterwards.
  const backfillN = parseInt(process.env.TECH_BACKFILL || '0', 10) || 0;
  const forced = backfillN > 0 ? all.filter((i) => !seen.has(i.id)).slice(-backfillN) : [];
  const forcedIds = new Set(forced.map((i) => i.id));

  if (newSources.length) {
    const baseline = all.filter((i) => newSources.includes(i.source));
    if (mode === 'dry') {
      console.log(`\nDry run. First time seeing: ${newSources.join(', ')}. A real run would only record their ${baseline.length} current items as already seen. Preview of the 3 newest:\n`);
      baseline.slice(-3).forEach((it) => console.log(buildMessage(it) + `\n${it.link}\n---`));
    } else {
      baseline.filter((i) => !forcedIds.has(i.id)).forEach((i) => seen.add(i.id));
      newSources.forEach((n) => knownSources.add(n));
      console.log(`Recorded baseline for ${newSources.join(', ')} (${baseline.length} items), posted nothing for them.`);
    }
  }

  const fresh = all.filter((i) => (!newSources.includes(i.source) || forcedIds.has(i.id)) && !seen.has(i.id));
  const cutoff = Date.now() - MAX_AGE_DAYS * 864e5;
  const stale = fresh.filter((i) => !forcedIds.has(i.id) && i.date.getTime() < cutoff);
  const postable = fresh.filter((i) => forcedIds.has(i.id) || i.date.getTime() >= cutoff).slice(0, Math.max(MAX_PER_RUN, forced.length));
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
      console.log(`${mode === 'draft' ? 'Drafted' : 'Posted'}: [${it.source}] ${it.title.slice(0, 60)} -> ${id}`);
      done.push(it.id);
    } catch (e) {
      console.error('Failed:', it.title.slice(0, 60), '|', e.message);
      failed = true;
      break; // keep order; retry this and later items next run
    }
  }
  if (mode !== 'dry') saveState(done, [...knownSources]);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error('tech-news failed:', e.message);
  process.exit(1);
});
