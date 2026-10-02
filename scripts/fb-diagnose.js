// Temporary: prints only yes/no facts about the Facebook secrets, never the
// token, never names (workflow logs of a public repo are public).
const { FB_PAGE_ID, FB_PAGE_TOKEN } = process.env;
const G = 'https://graph.facebook.com/v21.0';
async function get(p, params = {}) {
  const u = new URL(G + p);
  u.search = new URLSearchParams({ ...params, access_token: FB_PAGE_TOKEN });
  const r = await fetch(u);
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
}
const err = (b) => (b.error ? `error code ${b.error.code}${b.error.error_subcode ? '/' + b.error.error_subcode : ''}: ${String(b.error.message).slice(0, 160)}` : '');
(async () => {
  console.log('FB_PAGE_ID set:', !!FB_PAGE_ID, '| looks numeric:', /^\d+$/.test(FB_PAGE_ID || ''), '| FB_PAGE_TOKEN set:', !!FB_PAGE_TOKEN);
  const me = await get('/me', { fields: 'id' });
  console.log('/me ->', me.ok ? 'ok' : err(me.body));
  if (me.ok) console.log('token belongs to the configured FB_PAGE_ID:', me.body.id === FB_PAGE_ID);
  const cat = await get('/me', { fields: 'category' });
  console.log('token behaves like a PAGE token (has category):', cat.ok && !!cat.body.category);
  const page = await get('/' + FB_PAGE_ID, { fields: 'id' });
  console.log('FB_PAGE_ID readable with this token:', page.ok, page.ok ? '' : err(page.body));
  const perms = await get('/me/permissions');
  console.log('/me/permissions ->', perms.ok ? JSON.stringify((perms.body.data || []).map((p) => `${p.permission}:${p.status}`)) : err(perms.body));
  const acc = await get('/me/accounts', { fields: 'id' });
  console.log('/me/accounts ->', acc.ok ? `${(acc.body.data || []).length} page(s); configured id among them: ${(acc.body.data || []).some((p) => p.id === FB_PAGE_ID)}` : err(acc.body));
  const tasks = await get('/' + FB_PAGE_ID, { fields: 'tasks' });
  console.log('page tasks for this token ->', tasks.ok ? JSON.stringify(tasks.body.tasks || null) : err(tasks.body));
})();
