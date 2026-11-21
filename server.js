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
};

function secrets() { return readJson(FILES.secrets, {}); }
function sessions() { return readJson(FILES.sessions, {}); }
function teachers() { return readJson(FILES.teachers, []); }
const tokens = sessions();

/* form-urlencoded POST (securetoken API-д хэрэгтэй) */
function httpsForm(urlStr, params) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const body = new URLSearchParams(params || {}).toString();
    const req = https.request({
      method: 'POST',
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
        resolve({ status: res.statusCode || 0, data });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/* Багшийн Firebase Auth аккаунтыг устгах: эхлээд хадгалсан refresh token-оор (нууц үг хэрэггүй),
   болохгүй бол нууц үг өгөгдсөн үед нэвтэрч устгана. */
async function deleteTeacherAuth(s, email, rec, password) {
  if (rec && rec.rt) {
    try {
      const t = await httpsForm('https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(s.firebaseApiKey),
        { grant_type: 'refresh_token', refresh_token: rec.rt });
      const idToken = t.data && (t.data.id_token || t.data.idToken);
      if (t.status < 400 && idToken) {
        const del = await httpsJson('POST', 'https://identitytoolkit.googleapis.com/v1/accounts:delete?key=' + encodeURIComponent(s.firebaseApiKey), {}, { idToken });
        if (del.status < 400) return true;
      }
    } catch (e) { console.warn('refresh-token delete failed', e.message); }
  }
  if (password) {
    try {
      const signIn = await httpsJson('POST', 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + encodeURIComponent(s.firebaseApiKey), {},
        { email, password, returnSecureToken: true });
      if (signIn.status < 400) {
        const del = await httpsJson('POST', 'https://identitytoolkit.googleapis.com/v1/accounts:delete?key=' + encodeURIComponent(s.firebaseApiKey), {},
          { idToken: signIn.data.idToken });
        return del.status < 400;
      }
    } catch (e) { console.warn('password delete failed', e.message); }
  }
  return false;
}

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
    return json(res, 200, { ok: true, teachers: teachers().map((t) => ({ login: t.login, email: t.email, name: t.name, uid: t.uid, createdAt: t.createdAt })) }); // rt (refresh token) гадагш гаргахгүй
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
    let reclaimed = false;
    let rt = '';
    try {
      let idToken = '';
      const r = await httpsJson('POST',
        'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + encodeURIComponent(s.firebaseApiKey),
        {},
        { email, password, returnSecureToken: true });
      if (r.status >= 400) {
        const msg = (r.data && r.data.error && r.data.error.message) || JSON.stringify(r.data);
        if (!/EMAIL_EXISTS/i.test(msg)) return json(res, 400, { ok: false, error: msg });
        // Firebase-д хуучин аккаунт устгагдалгүй үлдсэн байна. Ижил нууц үгээр нэвтэрч чадвал
        // тэр аккаунтыг дахин ашиглана (устгасан багшийг дахин үүсгэх боломжтой болно).
        const si = await httpsJson('POST',
          'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + encodeURIComponent(s.firebaseApiKey),
          {},
          { email, password, returnSecureToken: true });
        if (si.status >= 400) {
          return json(res, 400, { ok: false, error: 'Энэ нэр Firebase-д бүртгэлтэй байна (устгагдаагүй), гэхдээ нууц үг таарахгүй тул дахин ашиглаж чадсангүй. Firebase Console → Authentication-оос хуучин аккаунтыг устгана уу.' });
        }
        uid = si.data.localId;
        idToken = si.data.idToken;
        rt = si.data.refreshToken || '';
        reclaimed = true;
      } else {
        uid = r.data.localId;
        idToken = r.data.idToken;
        rt = r.data.refreshToken || '';
      }
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
    // Нууц үгийг сервер файлд ХАДГАЛАХГҮЙ — устгах/солиход админ одоогийн нууц үгийг бичнэ.
    list.push({ login, email, name, uid, rt, createdAt: new Date().toISOString() });
    writeJson(FILES.teachers, list);
    return json(res, 200, { ok: true, email, uid, reclaimed });
  }

  if (p === '/api/admin/teachers/update' && req.method === 'POST') {
    const body = await readBody(req);
    const s = secrets();
    if (String(body.adminPassword || '') !== String(s.adminPassword || 'nimda321')) {
      return json(res, 400, { ok: false, error: 'Админы нууц үг буруу' });
    }
    const list = teachers();
    const oldLogin = String(body.oldLogin || '').trim();
    const i = list.findIndex((t) => t && (t.login === oldLogin || t.email === oldLogin));
    if (i < 0) return json(res, 404, { ok: false, error: 'Багш олдсонгүй' });
    const rec = list[i];
    const newLogin = String(body.login || rec.login || '').trim();
    const newName = String(body.name || rec.name || newLogin).trim().slice(0, 80);
    const oldEmail = String(rec.email || teacherEmail(rec.login)).toLowerCase();
    const newEmail = teacherEmail(newLogin);
    const newPass = String(body.password || '');
    const oldPass = String(body.currentPassword || '');
    const emailChanged = !!newEmail && newEmail !== oldEmail;
    const passChanged = !!newPass && newPass !== String(rec.password || '');
    if (!newLogin) return json(res, 400, { ok: false, error: 'Нэвтрэх нэр хоосон' });
    if (newPass && newPass.length < 6) return json(res, 400, { ok: false, error: 'Шинэ нууц үг 6+ тэмдэгт байх ёстой' });
    if (list.some((t, k) => k !== i && t && (t.login === newLogin || t.email === newEmail))) {
      return json(res, 400, { ok: false, error: 'Энэ нэвтрэх нэр аль хэдийн байна' });
    }
    let uid = rec.uid || '';
    let warning = '';
    let authRt = '';
    try {
      if (emailChanged || passChanged) {
        if (!oldPass) return json(res, 400, { ok: false, error: 'Одоогийн нууц үгийг оруулна уу' });
        const signIn = await httpsJson('POST', 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + encodeURIComponent(s.firebaseApiKey), {},
          { email: oldEmail, password: oldPass, returnSecureToken: true });
        if (signIn.status >= 400) {
          const msg = (signIn.data && signIn.data.error && signIn.data.error.message) || 'Алдаа';
          return json(res, 400, { ok: false, error: 'Одоогийн нууц үг буруу: ' + msg });
        }
        uid = signIn.data.localId || uid;
        authRt = signIn.data.refreshToken || '';
        if (!emailChanged) {
          const up = await httpsJson('POST', 'https://identitytoolkit.googleapis.com/v1/accounts:update?key=' + encodeURIComponent(s.firebaseApiKey), {},
            { idToken: signIn.data.idToken, returnSecureToken: true, password: newPass, displayName: newName });
          if (up.status >= 400) {
            const msg = (up.data && up.data.error && up.data.error.message) || 'Firebase update алдаа';
            return json(res, 400, { ok: false, error: msg });
          }
          uid = (up.data && up.data.localId) || uid;
          authRt = (up.data && up.data.refreshToken) || authRt;
        } else {
          // Firebase нь нэвтрэх имэйлийг шууд солихыг зөвшөөрдөггүй (шинэ имэйл баталгаажуулалт шаардана),
          // тиймээс шинэ аккаунт үүсгээд хуучныг устгана. UID шинээр үүснэ.
          const pw = newPass || oldPass;
          const su = await httpsJson('POST', 'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + encodeURIComponent(s.firebaseApiKey), {},
            { email: newEmail, password: pw, returnSecureToken: true });
          if (su.status >= 400) {
            const msg = (su.data && su.data.error && su.data.error.message) || 'Алдаа';
            return json(res, 400, { ok: false, error: 'Шинэ нэвтрэх нэрээр аккаунт үүсгэсэнгүй: ' + msg });
          }
          await httpsJson('POST', 'https://identitytoolkit.googleapis.com/v1/accounts:update?key=' + encodeURIComponent(s.firebaseApiKey), {},
            { idToken: su.data.idToken, returnSecureToken: true, displayName: newName });
          const del = await httpsJson('POST', 'https://identitytoolkit.googleapis.com/v1/accounts:delete?key=' + encodeURIComponent(s.firebaseApiKey), {},
            { idToken: signIn.data.idToken });
          if (del.status >= 400) {
            const msg = (del.data && del.data.error && del.data.error.message) || 'Алдаа';
            warning = 'Хуучин аккаунтыг устгаж чадсангүй: ' + msg;
          }
          uid = su.data.localId || uid;
          authRt = su.data.refreshToken || authRt;
        }
      }
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
    list[i] = Object.assign({}, rec, { login: newLogin, name: newName, email: newEmail || oldEmail, uid, rt: (authRt || rec.rt || ''), updatedAt: new Date().toISOString() });
    writeJson(FILES.teachers, list);
    return json(res, 200, { ok: true, teacher: { login: list[i].login, name: list[i].name, uid: list[i].uid }, warning });
  }

  if (p.startsWith('/api/admin/teachers/') && req.method === 'DELETE') {
    const login = decodeURIComponent(p.split('/').pop());
    const body = await readBody(req);
    const s = secrets();
    if (String(body.adminPassword || '') !== String(s.adminPassword || 'nimda321')) {
      return json(res, 400, { ok: false, error: 'Админы нууц үг буруу' });
    }
    const list = teachers();
    const rec = list.find((t) => t && (t.login === login || t.email === login));
    let deleted = false;
    if (rec) {
      // Багшийн нууц үг шаардахгүй — админы нууц үг + «TIIM» хангалттай.
      // Аккаунтыг үүсгэх үед авсан refresh token-оор idToken авч Firebase-ээс бүрмөсөн устгана.
      deleted = await deleteTeacherAuth(s, rec.email || teacherEmail(rec.login), rec, String(body.currentPassword || ''));
    }
    writeJson(FILES.teachers, list.filter((t) => t.login !== login && t.email !== login));
    return json(res, 200, { ok: true, firebaseDeleted: deleted, authAccountRemains: !!rec && !deleted });
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
