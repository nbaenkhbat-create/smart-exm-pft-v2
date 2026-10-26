'use strict';
/**
 * SmartEXAM LAN host — binds 0.0.0.0 so other devices on the school network can open the app.
 * Admin:  http://<this-pc-ip>:<port>/admin-by-e-c-1771
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { URL } = require('url');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const PORT = Number(process.env.SE_PORT || 1771);
const HOST = process.env.SE_HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
};

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
ensureDir(DATA);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

const secretsPath = path.join(DATA, 'secrets.json');
if (!fs.existsSync(secretsPath)) {
  writeJson(secretsPath, {
    adminPassword: 'nimda321',
    groqKey1: '',
    groqKey2: '',
    firebaseApiKey: 'AIzaSyCNWh5yXA3RAzPNCifGXhihAOXhYboIIWY',
    firebaseDb: 'https://shalgalt-6933b-default-rtdb.asia-southeast1.firebasedatabase.app',
    reportEmail: 'nbaenkhbat@gmail.com'
  });
}

const FILES = {
  secrets: secretsPath,
  sessions: path.join(DATA, 'sessions.json'),
  teachers: path.join(DATA, 'teachers.json'),
  ai: path.join(DATA, 'ai-state.json'),
  chat: path.join(DATA, 'ai-chat.json'),
  sim: path.join(DATA, 'sim-workspace.json'),
  reports: path.join(DATA, 'ai-reports.json')
};

function secrets() { return readJson(FILES.secrets, {}); }
function sessions() { return readJson(FILES.sessions, {}); }
function teachers() { return readJson(FILES.teachers, []); }
function aiState() {
  return readJson(FILES.ai, {
    enabled: false,
    start: '08:00',
    end: '18:00',
    extraEmail: '',
    simLogin: '',
    simUid: '',
    lastTick: 0,
    lastReportAt: 0,
    commands: []
  });
}
function chatLog() { return readJson(FILES.chat, []); }
function simWs() {
  return readJson(FILES.sim, { exams: [], assignments: [], studentWork: [], audits: [] });
}

const tokens = sessions();

function lanIps() {
  const out = [];
  const ifs = os.networkInterfaces();
  Object.keys(ifs).forEach((name) => {
    (ifs[name] || []).forEach((i) => {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    });
  });
  return out;
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > 2e6) { req.destroy(); reject(new Error('too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { resolve({ _raw: raw }); }
    });
    req.on('error', reject);
  });
}

function httpsJson(method, urlStr, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const body = bodyObj == null ? null : JSON.stringify(bodyObj);
    const opts = {
      method,
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: Object.assign({
        'Content-Type': 'application/json',
        Accept: 'application/json'
      }, headers || {})
    };
    if (body) opts.headers['Content-Length'] = Buffer.byteLength(body);
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try { parsed = JSON.parse(text); } catch { parsed = { _text: text }; }
        resolve({ status: res.statusCode, data: parsed, text });
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

function teacherEmail(login) {
  const s = String(login || '').trim().toLowerCase();
  if (!s) return '';
  if (s.includes('@')) return s;
  const safe = s.replace(/[^a-z0-9._-]/g, '');
  return safe + '@smartexam.app';
}

function authAdmin(req) {
  const h = String(req.headers.authorization || '');
  const tok = h.replace(/^Bearer\s+/i, '').trim();
  if (!tok) return false;
  const rec = tokens[tok];
  if (!rec) return false;
  if (Date.now() - rec.at > 12 * 3600 * 1000) { delete tokens[tok]; writeJson(FILES.sessions, tokens); return false; }
  rec.at = Date.now();
  return true;
}

function pushChat(role, text, extra) {
  const list = chatLog();
  list.push(Object.assign({
    id: crypto.randomBytes(6).toString('hex'),
    t: new Date().toISOString(),
    role,
    text: String(text || '').slice(0, 4000)
  }, extra || {}));
  while (list.length > 400) list.shift();
  writeJson(FILES.chat, list);
  return list[list.length - 1];
}

function inSchedule(st) {
  const now = new Date();
  const hm = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = String(st.start || '00:00').split(':').map(Number);
  const [eh, em] = String(st.end || '23:59').split(':').map(Number);
  const a = (sh || 0) * 60 + (sm || 0);
  const b = (eh || 23) * 60 + (em || 59);
  if (a <= b) return hm >= a && hm <= b;
  return hm >= a || hm <= b;
}

// Groq дээд түвшинд загварууд хулагддаг тул (жишээ: llama-3.1-8b-instant аль хэдийн алга)
// нэг нь алдаа өгвөл дараагийн бэлэн загвар руу автоматаар шилжинэ.
const GROQ_MODELS = ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b'];
let groqModelIndex = 0;

/* data/secrets.json дахь түлхүүрүүд хүчингүй болоход (401) зогсохгүйн тулд
   хуудас дээр ашиглагддаж буй ажиллагаатай түлхүүрийг нөөцөөр авна. */
let pageKeyCache = null;
function pageGroqKey() {
  if (pageKeyCache) return pageKeyCache;
  try {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const line = String(html).split('\n').find((l) => l.indexOf('const SCAN_GROQ_KEY = ') === 0);
    if (line) pageKeyCache = Function(line.replace('const SCAN_GROQ_KEY = ', 'return '))();
  } catch (e) { console.warn('page key decode:', e.message); }
  return pageKeyCache || '';
}

async function groqChat(which, messages, maxTok) {
  const s = secrets();
  const primary = which === 2 ? s.groqKey2 : s.groqKey1;
  const secondary = which === 2 ? s.groqKey1 : s.groqKey2;
  const keys = Array.from(new Set([primary, secondary, pageGroqKey()].filter(Boolean)));
  if (!keys.length) throw new Error('GROQ key missing');
  let lastErr = null;
  for (let ki = 0; ki < keys.length; ki++) {
    for (let attempt = 0; attempt < GROQ_MODELS.length; attempt++) {
      const model = GROQ_MODELS[(groqModelIndex + attempt) % GROQ_MODELS.length];
      const r = await httpsJson('POST', 'https://api.groq.com/openai/v1/chat/completions', {
        Authorization: 'Bearer ' + keys[ki]
      }, {
        model,
        temperature: 0.3,
        max_tokens: maxTok || 280,
        messages
      });
      const msg = r.data && r.data.choices && r.data.choices[0] && r.data.choices[0].message;
      if (r.status < 400 && msg && msg.content) {
        groqModelIndex = (groqModelIndex + attempt) % GROQ_MODELS.length;
        return msg.content;
      }
      lastErr = new Error((r.data && r.data.error && r.data.error.message) || ('Groq ' + r.status));
      // 401/403 → түлхүүр солих; 404/400 → загвар солих; бусад → дараагийн түлхүүр рүү
      if (r.status === 401 || r.status === 403) break;
      if (r.status !== 404 && r.status !== 400) break;
    }
  }
  throw lastErr || new Error('Groq алдаа');
}

async function sendReportEmail(toList, subject, message) {
  const s = secrets();
  const addrs = Array.from(new Set([s.reportEmail, ...toList].filter(Boolean)));
  const results = [];
  for (const to of addrs) {
    try {
      const r = await httpsJson('POST', 'https://formsubmit.co/ajax/' + encodeURIComponent(to), {
        Accept: 'application/json'
      }, {
        name: 'SmartEXAM AI',
        _subject: subject,
        message
      });
      results.push({ to, ok: r.status < 400, status: r.status });
    } catch (e) {
      results.push({ to, ok: false, error: e.message });
    }
  }
  const reports = readJson(FILES.reports, []);
  reports.push({ t: new Date().toISOString(), subject, message: message.slice(0, 8000), results });
  writeJson(FILES.reports, reports.slice(-80));
  return results;
}

function compactLogs(n) {
  // AI1/AI2-ийн түүхий текстийг хасна: тэдгээр нь AI3-д бүрэн хэлбэрээр тусгайлан илгээгддэг бөгөөд
  // энд 180 тэмдэгтээр тасдагдаж хувирах тул AI3 "JSON тасдагдсан" гэж буруу дүгнэдэг байв.
  return chatLog()
    .filter((m) => m.role !== 'AI1' && m.role !== 'AI2')
    .slice(-n)
    .map((m) => m.role + ': ' + String(m.text).replace(/\s+/g, ' ').slice(0, 180)).join('\n');
}

async function workerTick() {
  const st = aiState();
  if (!st.enabled || !inSchedule(st)) return;
  const now = Date.now();
  if (now - (st.lastTick || 0) < 40000) return; // rate limit
  st.lastTick = now;
  writeJson(FILES.ai, st);

  const ws = simWs();
  const sys = 'MN school exam sim. Reply compact MN/EN. Max 80 words. No secrets.';
  const cmd = (st.commands || []).shift();
  if (cmd) writeJson(FILES.ai, st);

  try {
    // AI4 first if admin queued a command
    if (cmd) {
      const out = await groqChat(2, [
        { role: 'system', content: sys + ' You are AI4 admin secretary. Do the task or report AI1-3 status.' },
        { role: 'user', content: ('CMD:' + cmd + '\nLOG:\n' + compactLogs(8)).slice(0, 1200) }
      ], 220);
      pushChat('AI4', out, { kind: 'command' });
    }

    const exams = ws.exams || [];
    const lastExam = exams[exams.length - 1];

    const a1 = await groqChat(1, [
      { role: 'system', content: 'You are AI1, an English teacher. Output ONLY one complete ASCII-JSON object: no markdown, no commentary, no Cyrillic, plain English text only. Shape: {"title":"...","q":[{"t":"question text","type":"mcq","opts":["a","b","c","d"],"ans":"exact option text"}]}. Use type mcq (4 opts) or blank (opts:[]). Exactly 5 questions. Every JSON string and bracket must be closed.' },
      { role: 'user', content: 'Make a 5-question English practice set. Rotate topic: vocabulary / gerunds / so that / tenses.' }
    ], 700);
    pushChat('AI1', a1, { kind: 'teach' });
    let exam = null;
    try {
      const m = a1.match(/\{[\s\S]*\}/);
      exam = m ? JSON.parse(m[0]) : { title: 'AI дасгал', q: [] };
    } catch { exam = { title: 'AI дасгал', raw: a1.slice(0, 400) }; }
    exam.id = 'sim-' + Date.now();
    exam.at = new Date().toISOString();
    exam.owner = st.simLogin || 'sim';
    ws.exams = (ws.exams || []).slice(-20).concat([exam]);

    const a2 = await groqChat(1, [
      { role: 'system', content: 'You are AI2, a student. Reply ONLY with a complete ASCII-JSON object {"answers":[...]} — one answer per question, in order, matching each option text exactly. No markdown, no Cyrillic, no extra text.' },
      { role: 'user', content: JSON.stringify({ title: exam.title, q: (exam.q || []).map((q) => ({ t: q.t, type: q.type, opts: q.opts })) }).slice(0, 1600) }
    ], 400);
    pushChat('AI2', a2, { kind: 'student' });
    ws.studentWork = (ws.studentWork || []).slice(-20).concat([{ examId: exam.id, a2, at: exam.at }]);

    const a3 = await groqChat(2, [
      { role: 'system', content: sys + ' You are AI3 auditor. Find bugs/unclear text. JSON {"bugs":[],"ideas":[]}' },
      { role: 'user', content: ('AI1:\n' + a1 + '\nAI2:\n' + a2 + '\nLOG:\n' + compactLogs(6)).slice(0, 1400) }
    ], 240);
    pushChat('AI3', a3, { kind: 'audit' });
    ws.audits = (ws.audits || []).slice(-20).concat([{ at: exam.at, a3 }]);
    writeJson(FILES.sim, ws);
  } catch (e) {
    pushChat('SYS', 'AI алдаа: ' + (e.message || e), { kind: 'error' });
  }

  // End-of-window report once
  const st2 = aiState();
  const [eh, em] = String(st2.end || '18:00').split(':').map(Number);
  const nowD = new Date();
  const endMin = (eh || 18) * 60 + (em || 0);
  const hm = nowD.getHours() * 60 + nowD.getMinutes();
  const dayKey = nowD.toISOString().slice(0, 10);
  if (hm >= endMin && st2.lastReportAt !== dayKey && (ws.exams || []).length) {
    const body = 'SmartEXAM AI өдрийн тайлан ' + dayKey + '\n\n' + compactLogs(30);
    try {
      await sendReportEmail([st2.extraEmail], 'SmartEXAM AI тайлан ' + dayKey, body);
      pushChat('SYS', 'Тайлан имэйл илгээлээ.', { kind: 'mail' });
    } catch (e) {
      pushChat('SYS', 'Имэйл алдаа: ' + e.message, { kind: 'error' });
    }
    st2.lastReportAt = dayKey;
    writeJson(FILES.ai, st2);
  }
}

setInterval(() => { workerTick().catch((e) => console.warn('tick', e.message)); }, 15000);

async function handleApi(req, res, url) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS'
    });
    res.end();
    return;
  }

  const p = url.pathname;
  if (p === '/api/health') {
    return json(res, 200, { ok: true, ips: lanIps(), port: PORT, time: new Date().toISOString() });
  }

  if (p === '/api/admin/login' && req.method === 'POST') {
    const body = await readBody(req);
    const s = secrets();
    if (String(body.password || '') !== String(s.adminPassword || 'nimda321')) {
      return json(res, 401, { ok: false, error: 'Нууц үг буруу' });
    }
    const tok = crypto.randomBytes(24).toString('hex');
    tokens[tok] = { at: Date.now() };
    writeJson(FILES.sessions, tokens);
    return json(res, 200, { ok: true, token: tok });
  }

  if (p === '/api/admin/me') {
    if (!authAdmin(req)) return json(res, 401, { ok: false });
    return json(res, 200, { ok: true });
  }

  if (!p.startsWith('/api/admin/')) return json(res, 404, { error: 'not found' });
  if (!authAdmin(req)) return json(res, 401, { ok: false, error: 'admin' });

  if (p === '/api/admin/teachers' && req.method === 'GET') {
    return json(res, 200, { ok: true, teachers: teachers().map((t) => ({ login: t.login, email: t.email, name: t.name, uid: t.uid, createdAt: t.createdAt })) });
  }

  if (p === '/api/admin/teachers' && req.method === 'POST') {
    const body = await readBody(req);
    const login = String(body.login || '').trim();
    const password = String(body.password || '');
    const name = String(body.name || login).trim();
    if (!login || password.length < 6) return json(res, 400, { ok: false, error: 'Нэвтрэх нэр болон 6+ нууц үг хэрэгтэй' });
    const email = teacherEmail(login);
    const s = secrets();
    let uid = '';
    try {
      const r = await httpsJson('POST',
        'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + encodeURIComponent(s.firebaseApiKey),
        {},
        { email, password, returnSecureToken: true });
      if (r.status >= 400) {
        const msg = (r.data && r.data.error && r.data.error.message) || JSON.stringify(r.data);
        return json(res, 400, { ok: false, error: msg });
      }
      uid = r.data.localId;
      const idToken = r.data.idToken;
      await httpsJson('POST',
        'https://identitytoolkit.googleapis.com/v1/accounts:update?key=' + encodeURIComponent(s.firebaseApiKey),
        {},
        { idToken, displayName: name, returnSecureToken: false });
      const db = String(s.firebaseDb || '').replace(/\/$/, '');
      const payload = JSON.stringify({ role: 'teacher', name, login, email, createdBy: 'admin' });
      await httpsJson('PUT', db + '/users/' + uid + '.json?auth=' + encodeURIComponent(idToken), {}, JSON.parse(payload));
      await httpsJson('PUT', db + '/teachers/' + uid + '.json?auth=' + encodeURIComponent(idToken), {}, {
        displayName: name, email, login, createdAt: new Date().toISOString()
      });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
    const list = teachers();
    list.push({ login, email, name, uid, createdAt: new Date().toISOString() });
    writeJson(FILES.teachers, list);
    return json(res, 200, { ok: true, email, uid });
  }

  if (p.startsWith('/api/admin/teachers/') && req.method === 'DELETE') {
    const login = decodeURIComponent(p.split('/').pop());
    writeJson(FILES.teachers, teachers().filter((t) => t.login !== login && t.email !== login));
    return json(res, 200, { ok: true });
  }

  if (p === '/api/admin/ai/state' && req.method === 'GET') {
    const st = aiState();
    // AI1/AI2-ын түүхий ажиллагааг админд үзүүлэхгүй (зөвхөн үр дүн нь тест/дүнгээр гарна)
    const shown = chatLog().filter((m) => m.role !== 'AI1' && m.role !== 'AI2');
    return json(res, 200, { ok: true, state: st, inSchedule: inSchedule(st), chat: shown.slice(-80), sim: simWs() });
  }

  if (p === '/api/admin/ai/state' && req.method === 'POST') {
    const body = await readBody(req);
    const st = aiState();
    const wasOn = !!st.enabled;
    if (typeof body.enabled === 'boolean') st.enabled = body.enabled;
    if (body.start) st.start = String(body.start).slice(0, 5);
    if (body.end) st.end = String(body.end).slice(0, 5);
    if (body.extraEmail != null) st.extraEmail = String(body.extraEmail).trim();
    if (body.simLogin != null) st.simLogin = String(body.simLogin).trim();
    writeJson(FILES.ai, st);
    // Зөвхөн ON/OFF өөрчлөгдсөн үед л мэдэгдэл нэмнэ (ажил цаг/имэйл/нэр солих бүрт давтаж байсан)
    if (typeof body.enabled === 'boolean' && !!st.enabled !== wasOn) {
      pushChat('SYS', st.enabled ? ('AI асаалаа ' + st.start + '–' + st.end) : 'AI унтраалаа');
    }
    return json(res, 200, { ok: true, state: st });
  }

  if (p === '/api/admin/ai/command' && req.method === 'POST') {
    const body = await readBody(req);
    const text = String(body.text || '').trim();
    if (!text) return json(res, 400, { ok: false, error: 'хоосон' });
    const st = aiState();
    st.commands = st.commands || [];
    st.commands.push(text.slice(0, 500));
    writeJson(FILES.ai, st);
    pushChat('ADMIN', text, { kind: 'inbox' });
    return json(res, 200, { ok: true });
  }

  if (p === '/api/admin/ai/email' && req.method === 'POST') {
    const body = await readBody(req);
    const extra = String(body.to || aiState().extraEmail || '').trim();
    const msg = String(body.message || compactLogs(40));
    const results = await sendReportEmail([extra], String(body.subject || 'SmartEXAM мэдэгдэл'), msg);
    return json(res, 200, { ok: true, results });
  }

  json(res, 404, { error: 'not found' });
}

function isAdminPath(p) {
  return p === '/admin-by-e-c-1771' || p === '/amdin-by-e-c-1771' || p === '/admin-by-e-c-1771/' || p === '/amdin-by-e-c-1771/';
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=120'
    });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/index.html';
    if (isAdminPath(p)) {
      serveFile(res, path.join(ROOT, 'index.html'));
      return;
    }
    const safe = path.normalize(p).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(ROOT, safe);
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403); res.end(); return;
    }
    fs.stat(filePath, (err, st) => {
      if (!err && st.isFile()) return serveFile(res, filePath);
      serveFile(res, path.join(ROOT, 'index.html'));
    });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  const ips = lanIps();
  console.log('SmartEXAM LAN host');
  console.log('  Local:  http://127.0.0.1:' + PORT + '/');
  ips.forEach((ip) => console.log('  LAN:    http://' + ip + ':' + PORT + '/'));
  console.log('  Admin:  http://' + (ips[0] || '127.0.0.1') + ':' + PORT + '/admin-by-e-c-1771');
});
