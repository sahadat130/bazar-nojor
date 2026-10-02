// Run on YOUR PC:  node fb-setup.js
// Never prints a token. Inputs marked (hidden) are not echoed. It turns the
// short-lived token from Graph API Explorer into the numeric Page ID and the
// Page access token the workflows need, and leaves the Page token on your
// clipboard so you can paste it into the GitHub secret FB_PAGE_TOKEN.
const readline = require('readline');
const { spawnSync } = require('child_process');

const G = 'https://graph.facebook.com/v21.0';

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
    if (hidden) {
      rl._writeToOutput = function (s) {
        if (s === question) rl.output.write(s); // show the prompt, swallow what is typed or pasted
      };
    }
  });
}

async function api(path, params) {
  const url = new URL(G + path);
  url.search = new URLSearchParams(params);
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = body.error || {};
    throw new Error(`Facebook said: ${e.message || res.status} (code ${e.code ?? '?'})`);
  }
  return body;
}

const clip = (text) => spawnSync('clip', { input: text, shell: true });

(async () => {
  const appId = await ask('App ID (Meta app -> Settings -> Basic): ');
  const appSecret = await ask('App Secret (hidden): ', true);
  const shortToken = await ask('Access token from Graph API Explorer (hidden): ', true);

  const exchanged = await api('/oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortToken,
  });
  const longToken = exchanged.access_token;

  const perms = await api('/me/permissions', { access_token: longToken });
  const granted = (perms.data || []).filter((p) => p.status === 'granted').map((p) => p.permission);
  let ok = true;
  for (const need of ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts']) {
    const has = granted.includes(need);
    console.log(`  ${has ? 'OK     ' : 'MISSING'}  ${need}`);
    if (!has) ok = false;
  }
  if (!ok) throw new Error('A permission is missing. Add it in Graph API Explorer, generate the token again, and rerun.');

  const pages = (await api('/me/accounts', { fields: 'id,name,access_token', access_token: longToken })).data || [];
  if (!pages.length) throw new Error('No pages returned. Tick your page when Facebook asks which pages to allow.');

  console.log('\nPages you manage:');
  pages.forEach((p, i) => console.log(`  [${i + 1}] ${p.name}   (id ${p.id})`));
  const n = parseInt(await ask('\nWhich number is the page to post on? '), 10);
  const page = pages[n - 1];
  if (!page) throw new Error('That number is not in the list.');

  clip(page.access_token);
  console.log(`\nFB_PAGE_ID    = ${page.id}   (a plain number)`);
  console.log('FB_PAGE_TOKEN = copied to your clipboard (not shown).');
  console.log('\nNow open https://github.com/sahadat130/bazar-nojor/settings/secrets/actions');
  console.log('  1. FB_PAGE_ID    -> type the number above');
  console.log('  2. FB_PAGE_TOKEN -> press Ctrl+V');
  await ask('\nPress Enter once both secrets are saved (this clears the clipboard). ');
  clip(' ');
})().catch((e) => {
  console.error('\nStopped: ' + e.message);
  process.exit(1);
});
