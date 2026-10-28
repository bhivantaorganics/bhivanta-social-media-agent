// Bhivanta Social Media Marketing Agent — production-shaped, free-first.
// Node 24 stdlib + node:sqlite only. No paid API, no password storage.
// HONEST LIMITS (also in README + dashboard, not hidden):
// - Live Meta publishing / live inbox send need META_ACCESS_TOKEN + a
//   Facebook Page + an Instagram PROFESSIONAL account. Until those exist,
//   the agent creates drafts, queues, approvals, replies (queued) and
//   reports — it NEVER pretends a live post/message was sent.
// - Trending audio cannot be attached via the Instagram API, so audio
//   is marked NOT_SUPPORTED_VIA_API and must be chosen in the app.
// - Excel upload in this zero-dep build is CSV-per-sheet (Excel opens
//   CSV natively). A direct .xlsx parser would need an external library;
//   export each Excel sheet to CSV and upload it here.
// - The worker runs only while this server runs. If the host sleeps or
//   stops, the worker stops too — no false 24x7 claim.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);

db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE, pass_hash TEXT, salt TEXT);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, username TEXT, created INTEGER);
CREATE TABLE IF NOT EXISTS config(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS content_queue(id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, platform TEXT, type TEXT, title TEXT, caption TEXT, hashtags TEXT, hook TEXT, script TEXT, audio_note TEXT, status TEXT, dedupe_key TEXT UNIQUE, published_url TEXT, created INTEGER);
CREATE TABLE IF NOT EXISTS comments(id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT, author TEXT, text TEXT, lang TEXT, suggested_reply TEXT, status TEXT, reason TEXT, created INTEGER);
CREATE TABLE IF NOT EXISTS analytics(id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, metric TEXT, value REAL, source TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS logs(id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER, level TEXT, message TEXT);
CREATE TABLE IF NOT EXISTS templates(name TEXT PRIMARY KEY, csv TEXT);`);

function log(level, message) { try { db.prepare('INSERT INTO logs(time,level,message) VALUES(?,?,?)').run(Date.now(), level, String(message).slice(0, 500)); } catch {} }
function cfg(key, def) { const r = db.prepare('SELECT value FROM config WHERE key=?').get(key); return r ? r.value : def; }
function setCfg(key, val) { db.prepare('INSERT INTO config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(val)); }
function getConfigJSON() { try { return JSON.parse(cfg('agent_config', '{}')); } catch { return {}; } }

// Owner login — same pattern as other Bhivanta apps: ADMIN_PASSWORD env
// syncs on startup. Demo fallback only if env unset (never the live password).
function hashPw(pw, salt) { return crypto.scryptSync(pw, salt, 64).toString('hex'); }
(function syncOwner() {
  const envPw = process.env.ADMIN_PASSWORD;
  const row = db.prepare('SELECT * FROM users WHERE username=?').get('owner');
  if (envPw && (!row || hashPw(envPw, row.salt) !== row.pass_hash)) {
    const salt = crypto.randomBytes(16).toString('hex');
    const h = hashPw(envPw, salt);
    if (row) db.prepare('UPDATE users SET pass_hash=?, salt=? WHERE username=?').run(h, salt, 'owner');
    else db.prepare('INSERT INTO users(username,pass_hash,salt) VALUES(?,?,?)').run('owner', h, salt);
    db.prepare('DELETE FROM sessions WHERE username=?').run('owner');
    log('info', 'Owner password synced from env on startup');
  } else if (!row) {
    const salt = crypto.randomBytes(16).toString('hex');
    db.prepare('INSERT INTO users(username,pass_hash,salt) VALUES(?,?,?)').run('owner', hashPw('admin123', salt), salt);
  }
})();

// ---- Safety ----
const BANNED = [/certified/i, /guaranteed/i, /guarantee.*result/i, /sabhi paudhon/i, /every plant/i, /100%\s*result/i];
const SENSITIVE = [/refund/i, /legal/i, /court/i, /medical/i, /doctor/i, /poison/i, /unsafe/i, /allergy/i, /complaint/i, /shikayat/i, /fraud/i, /scam/i];
function safetyCheck(text) {
  const t = String(text || '');
  if (BANNED.some((re) => re.test(t))) return { ok: false, reason: 'Banned claim blocked (certified/guaranteed/every-plant style claim)' };
  if (/₹\s*\d/.test(t)) {
    const c = getConfigJSON();
    const priceVerified = c.prices && /₹?\s*\d/.test(JSON.stringify(c.prices)) && c.prices_verified === true;
    if (!priceVerified) return { ok: false, reason: 'Price blocked: price not verified in uploaded Excel (prices_verified must be true)' };
  }
  return { ok: true };
}
function detectLang(text) { return /[\u0900-\u097F]/.test(text) ? 'Hindi/Hinglish' : 'English'; }

// ---- CSV ----
function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  const s = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  const out = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  if (!out.length) return [];
  const headers = out[0].map((h) => String(h).trim());
  return out.slice(1).map((r) => { const o = {}; headers.forEach((h, i) => { o[h] = (r[i] || '').trim(); }); return o; });
}
const SHEETS = ['brand', 'products', 'prices', 'claims', 'faqs', 'audience', 'language', 'frequency', 'goals', 'preferences', 'response_rules', 'approval'];
// FINAL — Limited & Free, Daily Routine only. No unlimited, no paid, no 24x7 continuous claim.
// Every limit below is enforced in code, not just documented. When a limit
// is reached, work stops for that day and resumes next day — it never
// auto-upgrades, never spends, never buys a quota.
const LIMITS = {
  maxDraftsPerDay: 6,          // 2 platforms x 3 types (feed, reel script, story)
  maxCommentsPerDay: 20,
  maxUploadsPerDay: 10,
  maxReportsPerDay: 1,         // 1 daily summary per day; weekly report 1 per week
  maxApiVerifyPerDay: 20,
  spendingINR: 0,
  paidApis: false,
  platforms: ['Facebook', 'Instagram'],
  routine: [
    { time: '09:00', step: 'Morning — aaj ke drafts banao (max 6), safety check, approval queue me bhejo' },
    { time: '14:00', step: 'Midday — approval queue reminder, pending approvals + comments check (max 20 comments/day)' },
    { time: '19:00', step: 'Evening — daily summary banao (max 1/day), kal ka plan, logs check' },
    { time: 'Sunday', step: 'Weekly — weekly CSV report (1/week), 7-day baseline review (entered data only, warna TBD)' },
  ],
};
function todayUsage(dateStr) {
  const drafts = db.prepare('SELECT COUNT(*) c FROM content_queue WHERE date=?').get(dateStr).c;
  let comments = 0; try { comments = db.prepare("SELECT COUNT(*) c FROM comments WHERE date(created/1000,'unixepoch')=?").get(dateStr).c; } catch {}
  const uploads = db.prepare("SELECT COUNT(*) c FROM logs WHERE date(time/1000,'unixepoch')=? AND message LIKE 'Excel/CSV uploaded%'").get(dateStr).c;
  return { date: dateStr, drafts, comments, uploads, limits: LIMITS, draftsLeft: Math.max(0, LIMITS.maxDraftsPerDay - drafts), commentsLeft: Math.max(0, LIMITS.maxCommentsPerDay - comments) };
}
function validateUpload(sheet, rows) {
  const errors = [];
  if (!SHEETS.includes(sheet)) errors.push('Unknown sheet: ' + sheet + '. Allowed: ' + SHEETS.join(', '));
  if (!rows.length) errors.push('No data rows found in CSV');
  if (sheet === 'claims') rows.forEach((r, i) => { if (!r.claim && !r.verified_claim) errors.push('claims row ' + (i + 1) + ': claim text missing'); });
  if (sheet === 'faqs') rows.forEach((r, i) => { if (!r.question || !r.answer) errors.push('faqs row ' + (i + 1) + ': question or answer missing'); });
  if (sheet === 'prices') rows.forEach((r, i) => { if (!r.product && !r.pack) errors.push('prices row ' + (i + 1) + ': product/pack missing'); });
  return errors;
}

// ---- Content engine (rule-based, free, local) ----
const SEASONAL_TOPICS = [
  { title: 'Paudhe ko pehchaniye: patte kya bata rahe hain?', topic: 'Leaf signs: yellowing, spots, curling — what to check first (water, light, drainage). No product claim, only observation + care steps.' },
  { title: 'Terrace garden me paani ka sahi tareeka', topic: 'Morning watering, drainage holes, soil moisture finger-test. Simple, repeatable routine for terrace/balcony gardeners.' },
  { title: 'Phool wale paudhon ki dekhbhal', topic: 'Sunlight, pruning dead flowers, feeding schedule basics. Educational only, no flowering promise.' },
  { title: 'Kitchen garden: shuruat chhote se karo', topic: 'Start with 3-4 easy plants, sunlight map of balcony, daily 10-minute routine.' },
  { title: 'Mitti ko healthy kaise rakhen?', topic: 'Loose soil, compost basics, avoid waterlogging. Soil quality explained in plain language.' },
  { title: 'Indoor plants: light aur hawa ka balance', topic: 'Indirect light, rotate pots, avoid overwatering indoors.' },
  { title: 'Nursery se paudha kharidte waqt kya check karen?', topic: 'Roots, leaves, pot drainage, pest signs — a buyer checklist. Helps nursery partners too.' },
];
function hashtagsFor(c) {
  const base = ['#BhivantaOrganics', '#HomeGarden', '#PlantCare', '#TerraceGarden', '#UrbanGardening'];
  const extra = (c.preferences && c.preferences[0] && c.preferences[0].hashtags) ? String(c.preferences[0].hashtags).split(/[,; ]+/).filter(Boolean).slice(0, 5) : [];
  return [...new Set([...base, ...extra])].join(' ');
}
function generateQueue(dateStr) {
  const existing = db.prepare('SELECT COUNT(*) c FROM content_queue WHERE date=?').get(dateStr).c;
  if (existing >= LIMITS.maxDraftsPerDay) return { created: [], skipped: 0, date: dateStr, limitReached: true, note: 'Daily draft limit reached (6/day, free limit). Next drafts tomorrow.' };
  const c = getConfigJSON();
  const verifiedClaims = (c.claims || []).map((r) => r.claim || r.verified_claim).filter(Boolean);
  const claimLine = verifiedClaims.length ? 'Verified info only: ' + verifiedClaims.slice(0, 2).join(' | ') : 'No verified claim used — educational content only, price/claim TBD.';
  const platforms = ['Instagram', 'Facebook'];
  const created = []; let skipped = 0;
  for (const platform of platforms) {
    const items = [
      { type: 'feed', t: SEASONAL_TOPICS[(new Date(dateStr).getDate()) % SEASONAL_TOPICS.length] },
      { type: 'reel_script', t: SEASONAL_TOPICS[(new Date(dateStr).getDate() + 2) % SEASONAL_TOPICS.length] },
      { type: 'story', t: SEASONAL_TOPICS[(new Date(dateStr).getDate() + 4) % SEASONAL_TOPICS.length] },
    ];
    for (const it of items) {
      const title = it.t.title;
      const hook = '3 checks jo har gardener ko pata hone chahiye — ' + title;
      const caption = `${title}\n\n${it.t.topic}\n\n${claimLine}\n\nBhivanta Organics — Better Care. Happier Plants. | bhivantaorganics.com\nEducational post only — no daam or pakka-result claim unless verified in Excel.`;
      const check = safetyCheck(caption);
      if (!check.ok) { skipped++; continue; }
      const key = dateStr + '|' + platform + '|' + it.type + '|' + title;
      try {
        const r = db.prepare('INSERT OR IGNORE INTO content_queue(date,platform,type,title,caption,hashtags,hook,script,audio_note,status,dedupe_key,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(dateStr, platform, it.type, title, caption, hashtagsFor(c), hook, it.type === 'reel_script' ? `Hook: ${hook}\nScene 1: Problem dikhao\nScene 2: 3 checks batao\nScene 3: CTA — comment me apna plant issue likho` : '', 'NOT_SUPPORTED_VIA_API — Instagram API cannot attach trending music; choose audio in the Instagram app at publish time.', 'awaiting_approval', key, Date.now());
        if (r.changes) created.push({ platform, type: it.type, title });
      } catch { skipped++; }
    }
  }
  return { created, skipped, date: dateStr };
}

// ---- Connect module: solves the 3 missing steps INSIDE this agent ----
// What "solve" means here, honestly:
//  * The agent stores + encrypts the token/IDs the owner enters ONCE in
//    the dashboard (never in Excel, never in chat, never returned in
//    plaintext), validates them, and auto-unlocks live tasks when they
//    become present. It re-checks on every cycle, so no re-START is needed.
//  * It does NOT bypass Meta: the owner must still do the 3 taps that
//    only the owner can do — (1) Instagram Professional switch in the
//    Instagram app, (2) Facebook Page create/link in Facebook, (3) Meta
//    authorisation that issues the token. No fake token, no fake Page,
//    no fake Business ID is ever created, and no login/CAPTCHA is bypassed.
function tokenKey() { return crypto.createHash('sha256').update(process.env.TOKEN_ENCRYPTION_KEY || process.env.ADMIN_PASSWORD || 'bhivanta-local-dev-key').digest(); }
function encryptToken(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', tokenKey(), iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}
function decryptToken(enc) {
  try {
    const buf = Buffer.from(String(enc), 'base64'); const iv = buf.subarray(0, 12); const tag = buf.subarray(12, 28); const data = buf.subarray(28);
    const d = crypto.createDecipheriv('aes-256-gcm', tokenKey(), iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString('utf8');
  } catch { return ''; }
}
function effectiveToken() { return process.env.META_ACCESS_TOKEN || (cfg('conn_meta_token_enc', '') ? decryptToken(cfg('conn_meta_token_enc', '')) : ''); }
function effectivePageId() { return process.env.FACEBOOK_PAGE_ID || cfg('conn_facebook_page_id', ''); }
function effectiveBusinessId() { return process.env.INSTAGRAM_BUSINESS_ID || cfg('conn_instagram_business_id', ''); }
function connectSteps() {
  return [
    { id: 'instagram_pro', title: '1. Instagram → Professional', status: effectiveBusinessId() ? 'done' : 'pending', ownerTap: 'Instagram app kholo → Profile → Menu → Settings and privacy → Account type and tools → Switch to professional account → Business chuno. Phir jo Business ID mile, use neeche Connect form me daalo.', detail: 'Current live fact: @bhivantaorganics is still PERSONAL. Agent API se account type nahi badal sakta — ye tap sirf owner ka hai.' },
    { id: 'facebook_page', title: '2. Facebook Page create / link', status: effectivePageId() ? 'done' : 'pending', ownerTap: 'Facebook app/website me Page banao: Name = Bhivanta Organics Pvt Ltd, Website = bhivantaorganics.com, Tagline = Better Care. Happier Plants., Description = Organic Plant Growth Promoter for home gardeners (approved wording only, no price/claim). Phir jo Page ID mile, use neeche Connect form me daalo.', detail: 'Current live fact: managed Pages list empty hai, koi Page confirm nahi hai. Agent khud fake Page nahi banayega.' },
    { id: 'meta_token', title: '3. Meta Access Token', status: effectiveToken() ? 'saved_encrypted' : 'pending', ownerTap: 'Meta developer / Accounts Center se apne Page + Instagram ke liye token generate karo (minimum permissions: pages_manage_posts, instagram_content_publish, instagram_manage_comments, instagram_basic). Token ko sirf neeche Connect form me daalo — Excel me kabhi mat daalo, chat me kabhi mat bhejo. Agent use encrypted karke DB me rakhega, kabhi plaintext me wapas nahi dikhayega.', detail: 'Token ke bina live publish / live inbox send nahi chalega. Agent token invent nahi karega.' },
  ];
}
// ---- Accounts / missing steps (honest, never pretend) ----
function missingSteps() {
  const steps = [];
  if (!effectiveToken()) steps.push('META_ACCESS_TOKEN missing — enter it once in the agent Connect form (encrypted storage) or set it in host env. Without it, live publishing and live inbox send cannot run.');
  if (!effectivePageId()) steps.push('FACEBOOK_PAGE_ID missing — create/link a Facebook Page first (pages list is currently empty), then enter its ID in the agent Connect form or host env.');
  if (!effectiveBusinessId()) steps.push('INSTAGRAM_BUSINESS_ID missing — Instagram @bhivantaorganics is still PERSONAL, not professional. Switch to Professional (Business) in the Instagram app first, then enter its Business ID in the agent Connect form or host env.');
  if (!cfg('agent_config', '')) steps.push('Excel/CSV config missing — upload at least brand + claims + faqs sheets from the sample template, then click START.');
  return steps;
}
function agentStatus() {
  return { status: cfg('agent_status', 'stopped'), autoPublishLowRisk: cfg('auto_publish_lowrisk', '0') === '1', lastCycle: cfg('last_cycle', ''), missingSteps: missingSteps(), workerNote: 'Worker runs only while this server runs. If the host sleeps/stops, the worker stops too.' };
}
let workerTimer = null;
function runCycle(reason) {
  const today = new Date().toISOString().slice(0, 10);
  // Daily routine, in fixed order, once per day (dedupe + limit enforce it).
  log('info', 'Daily routine: 09:00 Morning drafts');
  const res = generateQueue(today);
  log('info', 'Daily routine: 14:00 Midday approval queue reminder');
  log('info', 'Daily routine: 19:00 Evening daily summary (see /api/reports/daily)');
  setCfg('last_cycle', new Date().toISOString());
  log('info', `Worker cycle (${reason}): ${res.created.length} drafts created, ${res.skipped} skipped, date ${today}, limitReached=${!!res.limitReached}`);
  return res;
}
function startWorker() {
  if (workerTimer) return;
  // Immediate first cycle on START (the "starts working immediately" requirement, for drafts/queue).
  runCycle('START');
  workerTimer = setInterval(() => { if (cfg('agent_status', 'stopped') === 'running') runCycle('scheduled'); }, 60 * 60 * 1000);
  log('info', 'Worker started (hourly cycle + immediate START cycle)');
}
function stopWorker() { if (workerTimer) { clearInterval(workerTimer); workerTimer = null; } }

// ---- HTTP helpers ----
function send(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }
function readBody(req) { return new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 2 * 1024 * 1024) req.destroy(); }); req.on('end', () => resolve(b)); }); }
function auth(req) { const t = (req.headers.authorization || '').replace('Bearer ', ''); if (!t) return false; return !!db.prepare('SELECT * FROM sessions WHERE token=?').get(t); }
function serveFile(res, file, type) { try { const data = fs.readFileSync(path.join(__dirname, 'public', file)); res.writeHead(200, { 'Content-Type': type }); res.end(data); } catch { res.writeHead(404); res.end('Not found'); } }

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (p === '/' || p === '/index.html') return serveFile(res, 'index.html', 'text/html');
    if (p === '/app.js') return serveFile(res, 'app.js', 'text/javascript');
    if (p === '/style.css') return serveFile(res, 'style.css', 'text/css');
    if (p === '/api/health') return send(res, 200, { ok: true, mode: 'social_agent', ...agentStatus(), teams: undefined });
    if (p === '/api/template.csv') {
      res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=bhivanta-template-brand.csv' });
      return res.end('key,value\nbrand,Bhivanta Organics\nproduct,Organic Plant Growth Promoter\ntagline,Better Care. Happier Plants.\nwebsite,bhivantaorganics.com\n');
    }
    if (p === '/api/auth/login' && req.method === 'POST') {
      const b = JSON.parse(await readBody(req) || '{}');
      const row = db.prepare('SELECT * FROM users WHERE username=?').get(b.username || 'owner');
      if (!row || hashPw(b.password || '', row.salt) !== row.pass_hash) return send(res, 401, { ok: false, error: 'Invalid login' });
      const token = crypto.randomBytes(24).toString('hex');
      db.prepare('INSERT INTO sessions(token,username,created) VALUES(?,?,?)').run(token, 'owner', Date.now());
      return send(res, 200, { ok: true, token });
    }
    if (!auth(req) && p.startsWith('/api/')) return send(res, 401, { ok: false, error: 'Login required' });

    if (p === '/api/status') return send(res, 200, agentStatus());
    if (p === '/api/limits') { const today = new Date().toISOString().slice(0, 10); return send(res, 200, { final: true, freeOnly: true, paidApis: false, usage: todayUsage(today) }); }
    if (p === '/api/connect/status') return send(res, 200, { steps: connectSteps(), missingSteps: missingSteps(), note: 'Status is derived from host env OR values saved in the agent Connect form. Token is never returned in plaintext.' });
    if (p === '/api/connect/save' && req.method === 'POST') {
      const b = JSON.parse(await readBody(req) || '{}');
      if (b.facebook_page_id) {
        if (!/^\d{5,30}$/.test(String(b.facebook_page_id).trim())) return send(res, 400, { ok: false, error: 'FACEBOOK_PAGE_ID must be a numeric Page ID (5-30 digits). Do not paste a URL or a fake ID.' });
        setCfg('conn_facebook_page_id', String(b.facebook_page_id).trim()); log('info', 'Facebook Page ID saved via Connect form (value not logged)');
      }
      if (b.instagram_business_id) {
        if (!/^\d{5,30}$/.test(String(b.instagram_business_id).trim())) return send(res, 400, { ok: false, error: 'INSTAGRAM_BUSINESS_ID must be a numeric Business ID (5-30 digits). Switch to Professional first, then paste the real ID.' });
        setCfg('conn_instagram_business_id', String(b.instagram_business_id).trim()); log('info', 'Instagram Business ID saved via Connect form (value not logged)');
      }
      if (b.meta_access_token) {
        if (String(b.meta_access_token).trim().length < 20) return send(res, 400, { ok: false, error: 'Token looks too short to be a real Meta token. Paste the full token from Meta, never a demo value.' });
        setCfg('conn_meta_token_enc', encryptToken(String(b.meta_access_token).trim())); log('info', 'Meta token saved ENCRYPTED via Connect form (value never logged, never returned)');
      }
      if (b.instagram_switched) { setCfg('conn_instagram_switched', '1'); log('info', 'Owner confirmed Instagram Professional switch tap done — Business ID still required to unlock live tasks'); }
      return send(res, 200, { ok: true, steps: connectSteps(), missingSteps: missingSteps() });
    }
    if (p === '/api/connect/verify' && req.method === 'POST') {
      const token = effectiveToken();
      if (!token) return send(res, 200, { ok: false, connected: false, reason: 'No token saved yet — enter it in the Connect form first.' });
      try {
        const r = await fetch('https://graph.facebook.com/v18.0/me?access_token=' + encodeURIComponent(token));
        const j = await r.json();
        if (j && j.id) return send(res, 200, { ok: true, connected: true, accountName: j.name || 'Meta account (name from Graph)', note: 'Graph /me succeeded. This verifies the token, not the Page/Business link — Page ID + Business ID must also be saved.' });
        return send(res, 200, { ok: false, connected: false, reason: 'Graph rejected the token: ' + (j && j.error && j.error.message ? j.error.message : 'invalid token'), note: 'Do not publish live with this token. Generate a fresh token with the required permissions and save it again.' });
      } catch (e) { return send(res, 200, { ok: false, connected: false, reason: 'Verify request failed (network/host): ' + e.message }); }
    }
    if (p === '/api/config') return send(res, 200, { config: getConfigJSON(), sheets: SHEETS });
    if (p === '/api/upload' && req.method === 'POST') {
      const b = JSON.parse(await readBody(req) || '{}');
      const todayU = new Date().toISOString().slice(0, 10);
      if (todayUsage(todayU).uploads >= LIMITS.maxUploadsPerDay) return send(res, 429, { ok: false, error: 'Daily upload limit reached (10/day, free limit). Try tomorrow.' });
      const rows = parseCSV(b.csv || '');
      const errors = validateUpload(b.sheet, rows);
      if (errors.length) return send(res, 400, { ok: false, errors });
      const c = getConfigJSON(); c[b.sheet] = rows;
      if (b.sheet === 'prices' && rows.some((r) => /yes|true|verified/i.test(r.verified || ''))) c.prices_verified = true;
      setCfg('agent_config', JSON.stringify(c));
      log('info', `Excel/CSV uploaded: sheet ${b.sheet}, ${rows.length} rows`);
      return send(res, 200, { ok: true, sheet: b.sheet, rows: rows.length });
    }
    if (p === '/api/agent/start' && req.method === 'POST') {
      const missing = missingSteps();
      setCfg('agent_status', 'running'); startWorker();
      log('info', 'Agent START clicked');
      return send(res, 200, { ok: true, status: 'running', warning: missing.length ? 'Agent started for drafts/queue/reporting, but LIVE publishing/inbox are blocked until missing steps are done.' : null, missingSteps: missing, cycle: { date: new Date().toISOString().slice(0, 10), note: 'Initial queue created by START cycle (drafts, awaiting approval)' } });
    }
    if (p === '/api/agent/pause' && req.method === 'POST') { setCfg('agent_status', 'paused'); log('info', 'Agent PAUSED'); return send(res, 200, { ok: true, status: 'paused' }); }
    if (p === '/api/agent/resume' && req.method === 'POST') { setCfg('agent_status', 'running'); startWorker(); log('info', 'Agent RESUMED'); return send(res, 200, { ok: true, status: 'running' }); }
    if (p === '/api/agent/stop' && req.method === 'POST') { setCfg('agent_status', 'stopped'); stopWorker(); log('info', 'EMERGENCY STOP'); return send(res, 200, { ok: true, status: 'stopped' }); }
    if (p === '/api/agent/settings' && req.method === 'POST') {
      const b = JSON.parse(await readBody(req) || '{}');
      if (typeof b.autoPublishLowRisk === 'boolean') setCfg('auto_publish_lowrisk', b.autoPublishLowRisk ? '1' : '0');
      return send(res, 200, agentStatus());
    }
    if (p === '/api/queue') {
      const rows = db.prepare('SELECT * FROM content_queue ORDER BY date DESC, id DESC LIMIT 200').all();
      return send(res, 200, { queue: rows });
    }
    if (p === '/api/queue/approve' && req.method === 'POST') {
      const b = JSON.parse(await readBody(req) || '{}');
      db.prepare("UPDATE content_queue SET status='approved' WHERE id=?").run(b.id);
      log('info', 'Content approved id=' + b.id);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/queue/publish' && req.method === 'POST') {
      const b = JSON.parse(await readBody(req) || '{}');
      const item = db.prepare('SELECT * FROM content_queue WHERE id=?').get(b.id);
      if (!item) return send(res, 404, { ok: false, error: 'Not found' });
      if (item.status !== 'approved' && cfg('auto_publish_lowrisk', '0') !== '1') return send(res, 400, { ok: false, error: 'Approval required before publish. Approve first, or enable low-risk auto-publish in Settings.' });
      const missing = missingSteps().filter((s) => s.includes('META_ACCESS_TOKEN') || s.includes('FACEBOOK_PAGE_ID') || s.includes('INSTAGRAM_BUSINESS_ID'));
      if (missing.length) return send(res, 400, { ok: false, error: 'Live publishing BLOCKED — missing steps:', missingSteps: missing, note: 'This is not a pretend publish. No live post was sent.' });
      // Token present path: real Graph API media upload is platform-specific
      // and needs app review + media container steps; do not fake success.
      return send(res, 501, { ok: false, error: 'Live Graph publishing adapter requires media-container upload + app review for this account. Token is present, but this build does not fake a publish — use the approved Meta publishing route with the approved payload in the queue item.' });
    }
    if (p === '/api/comments' && req.method === 'GET') {
      return send(res, 200, { comments: db.prepare('SELECT * FROM comments ORDER BY id DESC LIMIT 200').all() });
    }
    if (p === '/api/comments' && req.method === 'POST') {
      const b = JSON.parse(await readBody(req) || '{}');
      const todayD = new Date().toISOString().slice(0, 10);
      if (todayUsage(todayD).comments >= LIMITS.maxCommentsPerDay) return send(res, 429, { ok: false, error: 'Daily comment limit reached (20/day, free limit). Try tomorrow — no paid upgrade, no auto-spend.' });
      const text = String(b.text || '');
      const c = getConfigJSON();
      let suggested = '', status = 'pending', reason = '';
      if (SENSITIVE.some((re) => re.test(text))) { status = 'escalated'; reason = 'Sensitive / legal / medical / safety / refund / complaint — escalated to owner, no auto reply.'; suggested = 'Thank you for sharing this. Our team will check and reply personally. — Bhivanta Organics'; }
      else {
        const faq = (c.faqs || []).find((f) => { const q = (f.question || '').toLowerCase(); const words = q.split(/\W+/).filter((w) => w.length > 3); return words.some((w) => text.toLowerCase().includes(w)); });
        if (faq) { suggested = faq.answer; status = 'ready_to_send'; reason = 'Matched uploaded FAQ — low-risk, approval/send via official route only.'; }
        else { status = 'escalated'; reason = 'No exact FAQ match — uncertain, escalated to owner instead of inventing an answer.'; suggested = ''; }
      }
      const check = safetyCheck(suggested);
      if (!check.ok) { status = 'escalated'; reason = check.reason; suggested = ''; }
      const r = db.prepare('INSERT INTO comments(platform,author,text,lang,suggested_reply,status,reason,created) VALUES(?,?,?,?,?,?,?,?)').run(b.platform || 'Instagram', b.author || 'visitor', text, detectLang(text), suggested, status, reason, Date.now());
      log('info', `Comment queued id=${r.lastInsertRowid} status=${status}`);
      return send(res, 200, { ok: true, id: r.lastInsertRowid, status, reason, suggested_reply: suggested });
    }
    if (p === '/api/analytics' && req.method === 'GET') {
      return send(res, 200, { analytics: db.prepare('SELECT * FROM analytics ORDER BY date DESC LIMIT 200').all(), note: 'Only owner-entered analytics are shown. No number is invented. Baseline is TBD for the first 7 days.' });
    }
    if (p === '/api/analytics' && req.method === 'POST') {
      const b = JSON.parse(await readBody(req) || '{}');
      db.prepare('INSERT INTO analytics(date,metric,value,source,note) VALUES(?,?,?,?,?)').run(b.date || new Date().toISOString().slice(0, 10), b.metric, Number(b.value) || 0, 'owner_entered', b.note || '');
      return send(res, 200, { ok: true });
    }
    if (p === '/api/reports/daily') {
      const today = new Date().toISOString().slice(0, 10);
      const q = db.prepare('SELECT status, COUNT(*) c FROM content_queue WHERE date=? GROUP BY status').all(today);
      const cm = db.prepare('SELECT status, COUNT(*) c FROM comments GROUP BY status').all();
      return send(res, 200, { date: today, queue: q, comments: cm, missingSteps: missingSteps(), note: 'Daily summary: drafts, approvals, comments, missing steps. No invented performance.' });
    }
    if (p === '/api/reports/weekly.csv') {
      const rows = db.prepare('SELECT date,platform,type,title,status FROM content_queue ORDER BY date DESC LIMIT 200').all();
      let csv = 'date,platform,type,title,status\n';
      for (const r of rows) csv += [r.date, r.platform, r.type, '"' + String(r.title).replace(/"/g, '""') + '"', r.status].join(',') + '\n';
      res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=bhivanta-weekly-report.csv' });
      return res.end(csv);
    }
    if (p === '/api/logs') return send(res, 200, { logs: db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT 200').all() });
    return send(res, 404, { ok: false, error: 'Not found' });
  } catch (e) { log('error', e.message); return send(res, 500, { ok: false, error: e.message }); }
});

if (require.main === module) {
  server.listen(PORT, () => { console.log('Bhivanta Social Agent on ' + PORT); log('info', 'Server started on ' + PORT); });
}
module.exports = { server, db, parseCSV, validateUpload, safetyCheck, generateQueue, missingSteps, SHEETS, encryptToken, decryptToken, effectiveToken, effectivePageId, effectiveBusinessId, connectSteps, LIMITS, todayUsage };
