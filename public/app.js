let token = localStorage.getItem('bhv_token') || '';
async function api(path, method, body) {
  const r = await fetch(path, { method: method || 'GET', headers: { 'Content-Type': 'application/json', Authorization: token ? 'Bearer ' + token : '' }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}
async function login() {
  const d = await api('/api/auth/login', 'POST', { username: document.getElementById('user').value, password: document.getElementById('pass').value });
  if (d.ok) { token = d.token; localStorage.setItem('bhv_token', token); document.getElementById('loginCard').classList.add('hidden'); document.getElementById('app').classList.remove('hidden'); loadStatus(); } else alert('Login failed');
}
async function loadLimits() { const d = await api('/api/limits'); document.getElementById('limits').textContent = JSON.stringify(d, null, 2); }
async function loadStatus() { const s = await api('/api/status'); document.getElementById('status').textContent = 'Status: ' + s.status + ' | Low-risk auto-publish: ' + s.autoPublishLowRisk + ' | Last cycle: ' + (s.lastCycle || 'none') + ' | ' + s.workerNote; document.getElementById('missing').textContent = 'Missing steps:\n' + (s.missingSteps.length ? s.missingSteps.join('\n') : 'None — accounts + config look ready (live publish still needs approval + token check at publish time).'); document.getElementById('autoLow').checked = s.autoPublishLowRisk; }
async function loadConnect() { const d = await api('/api/connect/status'); document.getElementById('connectStatus').textContent = JSON.stringify(d, null, 2); }
async function saveConnect() { const d = await api('/api/connect/save', 'POST', { instagram_business_id: document.getElementById('bizId').value, facebook_page_id: document.getElementById('pageId').value, meta_access_token: document.getElementById('metaToken').value }); document.getElementById('connMsg').textContent = JSON.stringify(d); document.getElementById('metaToken').value = ''; loadStatus(); loadConnect(); }
async function verifyConnect() { const d = await api('/api/connect/verify', 'POST', {}); alert(JSON.stringify(d, null, 2)); loadConnect(); }
async function markSwitched() { const d = await api('/api/connect/save', 'POST', { instagram_switched: true }); alert(JSON.stringify(d, null, 2)); loadConnect(); }
async function upload() {
  const f = document.getElementById('file').files[0]; if (!f) return alert('Choose a CSV file');
  const text = await f.text(); const d = await api('/api/upload', 'POST', { sheet: document.getElementById('sheet').value, csv: text });
  document.getElementById('upMsg').textContent = d.ok ? 'Uploaded: ' + d.sheet + ' (' + d.rows + ' rows)' : 'Error: ' + (d.errors || d.error);
  loadStatus();
}
async function agent(action) { const d = await api('/api/agent/' + action, 'POST', {}); alert(JSON.stringify(d, null, 2)); loadStatus(); loadQueue(); }
async function setAuto() { await api('/api/agent/settings', 'POST', { autoPublishLowRisk: document.getElementById('autoLow').checked }); loadStatus(); }
async function loadQueue() { const d = await api('/api/queue'); document.getElementById('queue').innerHTML = d.queue.map((q) => `<div class="item"><b>${q.platform} ${q.type}</b> — ${q.title} [${q.status}]<br>${q.caption.slice(0, 300)}<br><i>${q.hashtags}</i> | Audio: ${q.audio_note}<br><button onclick="approve(${q.id})">Approve</button> <button onclick="publish(${q.id})">Publish (blocked until token+Page+Pro account)</button></div>`).join('') || 'No queue yet — upload config and click START.'; }
async function approve(id) { await api('/api/queue/approve', 'POST', { id }); loadQueue(); }
async function publish(id) { const d = await api('/api/queue/publish', 'POST', { id }); alert(JSON.stringify(d, null, 2)); loadQueue(); }
async function addComment() { const d = await api('/api/comments', 'POST', { platform: document.getElementById('cPlat').value, author: document.getElementById('cAuthor').value, text: document.getElementById('cText').value }); alert(JSON.stringify(d, null, 2)); const c = await api('/api/comments'); document.getElementById('comments').innerHTML = c.comments.map((x) => `<div class="item"><b>${x.platform} ${x.author}</b>: ${x.text}<br>Status: ${x.status} — ${x.reason}<br>Reply: ${x.suggested_reply}</div>`).join(''); }
async function loadAnalytics() { const d = await api('/api/analytics'); document.getElementById('analytics').textContent = JSON.stringify(d, null, 2); }
async function loadDaily() { const d = await api('/api/reports/daily'); document.getElementById('daily').textContent = JSON.stringify(d, null, 2); }
async function loadLogs() { const d = await api('/api/logs'); document.getElementById('logs').textContent = d.logs.map((l) => new Date(l.time).toLocaleString() + ' ' + l.level + ' ' + l.message).join('\n'); }
if (token) { document.getElementById('loginCard').classList.add('hidden'); document.getElementById('app').classList.remove('hidden'); loadStatus(); }
