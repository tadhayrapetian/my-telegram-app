/* =============================================================================
   Slate — сервер: аккаунты преподавателей, изоляция данных, лимиты тарифов.

   Без единой внешней зависимости: только встроенные модули Node 22.
   Запуск:  node server.js        (по умолчанию http://localhost:3000)
   ============================================================================= */

"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const mail = require("./mail");
const bot = require("./bot");
const ics = require("./ics");
const { DatabaseSync } = require("node:sqlite");

const PORT = +process.env.PORT || 3000;
const DATA_DIR = process.env.SLATE_DATA || path.join(__dirname, "data");
const PUBLIC_DIR = path.join(__dirname, "public");
/* Пока нет доставки кодов (почта или Telegram), код входа возвращается в ответе.
   На боевом сервере поставьте SLATE_DEV_CODES=0 — тогда код только в логах. */
/* Пока письма не настроены, код показываем на экране — иначе войти нельзя.
   Как только почтовая служба подключена, код уходит только письмом;
   SLATE_DEV_CODES=1 оставляет его на экране принудительно (для отладки). */
/* Хозяин сервиса: видит все школы, меняет тарифы. Список адресов
   через запятую в SLATE_ADMIN. Пусто — админки нет ни у кого. */
const ADMINS = (process.env.SLATE_ADMIN || "").toLowerCase().split(",")
  .map((x) => x.trim()).filter(Boolean);
const isAdmin = (user) => !!user && ADMINS.includes(String(user.email || "").toLowerCase());

const DEV_CODES = process.env.SLATE_DEV_CODES === "1" ||
                  (!mail.configured() && process.env.SLATE_DEV_CODES !== "0");

fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------------------------------------------------------------- секрет --- */
const SECRET_FILE = path.join(DATA_DIR, "secret.key");
let SECRET;
try {
  SECRET = fs.readFileSync(SECRET_FILE, "utf8").trim();
} catch (e) {
  SECRET = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(SECRET_FILE, SECRET, { mode: 0o600 });
}
const hmac = (s) => crypto.createHmac("sha256", SECRET).update(String(s)).digest("hex");

/* ------------------------------------------------------------------- база --- */
const db = new DatabaseSync(path.join(DATA_DIR, "slate.db"));
db.exec("PRAGMA journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS schools (
  id TEXT PRIMARY KEY, name TEXT, plan TEXT NOT NULL DEFAULT 'free', created_at INTEGER
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, school_id TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  name TEXT, role TEXT NOT NULL DEFAULT 'teacher', created_at INTEGER
);
CREATE TABLE IF NOT EXISTS codes (
  email TEXT PRIMARY KEY, code_hash TEXT, expires INTEGER, tries INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER
);
CREATE TABLE IF NOT EXISTS docs (
  user_id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 0, data TEXT, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS portal (
  token TEXT PRIMARY KEY, user_id TEXT NOT NULL, student_id TEXT NOT NULL, updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS portal_user ON portal(user_id);
/* ссылка на наш календарь для подписки */
CREATE TABLE IF NOT EXISTS ics (
  user_id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS ics_token ON ics(token);
/* чужой календарь (iCloud, Google), который мы показываем внутри Slate */
CREATE TABLE IF NOT EXISTS feeds (
  user_id TEXT PRIMARY KEY, url TEXT NOT NULL, name TEXT,
  events TEXT, fetched_at INTEGER, error TEXT
);
CREATE TABLE IF NOT EXISTS psessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, student_id TEXT NOT NULL, expires INTEGER
);
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, student_id TEXT NOT NULL,
  name TEXT, mime TEXT, size INTEGER, kind TEXT NOT NULL DEFAULT 'file',
  author TEXT NOT NULL DEFAULT 'teacher', created_at INTEGER
);
CREATE INDEX IF NOT EXISTS files_student ON files(user_id, student_id);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, student_id TEXT NOT NULL,
  author TEXT NOT NULL, text TEXT, file_id TEXT, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS messages_student ON messages(user_id, student_id, created_at);
`);
bot.schema(db);          /* таблицы привязок и отправленных напоминаний */

const q = {
  schoolById: db.prepare("SELECT * FROM schools WHERE id = ?"),
  addSchool: db.prepare("INSERT INTO schools (id,name,plan,created_at) VALUES (?,?,?,?)"),
  setPlan: db.prepare("UPDATE schools SET plan = ? WHERE id = ?"),
  userByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
  userById: db.prepare("SELECT * FROM users WHERE id = ?"),
  usersOfSchool: db.prepare("SELECT * FROM users WHERE school_id = ? ORDER BY created_at"),
  allUsers: db.prepare("SELECT * FROM users"),
  allSchools: db.prepare("SELECT * FROM schools ORDER BY created_at DESC"),
  icsOf: db.prepare("SELECT * FROM ics WHERE user_id = ?"),
  icsByToken: db.prepare("SELECT * FROM ics WHERE token = ?"),
  setIcs: db.prepare("INSERT INTO ics (user_id,token,created_at) VALUES (?,?,?) " +
                     "ON CONFLICT(user_id) DO UPDATE SET token=excluded.token, created_at=excluded.created_at"),
  feedOf: db.prepare("SELECT * FROM feeds WHERE user_id = ?"),
  setFeed: db.prepare("INSERT INTO feeds (user_id,url,name,events,fetched_at,error) VALUES (?,?,?,?,?,?) " +
                      "ON CONFLICT(user_id) DO UPDATE SET url=excluded.url, name=excluded.name, " +
                      "events=excluded.events, fetched_at=excluded.fetched_at, error=excluded.error"),
  dropFeed: db.prepare("DELETE FROM feeds WHERE user_id = ?"),
  /* полное удаление школы: всё, что связано с её людьми */
  countFiles: db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS bytes FROM files WHERE user_id = ?"),
  countMsgs: db.prepare("SELECT COUNT(*) AS n FROM messages WHERE user_id = ?"),
  wipeFiles: db.prepare("DELETE FROM files WHERE user_id = ?"),
  wipeMsgs: db.prepare("DELETE FROM messages WHERE user_id = ?"),
  wipeDoc: db.prepare("DELETE FROM docs WHERE user_id = ?"),
  wipePortal: db.prepare("DELETE FROM portal WHERE user_id = ?"),
  wipePS: db.prepare("DELETE FROM psessions WHERE user_id = ?"),
  wipeSessions: db.prepare("DELETE FROM sessions WHERE user_id = ?"),
  wipeUser: db.prepare("DELETE FROM users WHERE id = ?"),
  wipeSchool: db.prepare("DELETE FROM schools WHERE id = ?"),
  addUser: db.prepare("INSERT INTO users (id,school_id,email,name,role,created_at) VALUES (?,?,?,?,?,?)"),
  delUser: db.prepare("DELETE FROM users WHERE id = ? AND school_id = ?"),
  setUserName: db.prepare("UPDATE users SET name = ? WHERE id = ?"),
  setSchoolName: db.prepare("UPDATE schools SET name = ? WHERE id = ?"),
  putCode: db.prepare("INSERT INTO codes (email,code_hash,expires,tries) VALUES (?,?,?,0) " +
                      "ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash, expires=excluded.expires, tries=0"),
  getCode: db.prepare("SELECT * FROM codes WHERE email = ?"),
  bumpTries: db.prepare("UPDATE codes SET tries = tries + 1 WHERE email = ?"),
  dropCode: db.prepare("DELETE FROM codes WHERE email = ?"),
  addSession: db.prepare("INSERT INTO sessions (id,user_id,expires) VALUES (?,?,?)"),
  getSession: db.prepare("SELECT * FROM sessions WHERE id = ?"),
  delSession: db.prepare("DELETE FROM sessions WHERE id = ?"),
  getDoc: db.prepare("SELECT * FROM docs WHERE user_id = ?"),
  putDoc: db.prepare("INSERT INTO docs (user_id,version,data,updated_at) VALUES (?,?,?,?) " +
                     "ON CONFLICT(user_id) DO UPDATE SET version=excluded.version, data=excluded.data, updated_at=excluded.updated_at"),
  clearPortal: db.prepare("DELETE FROM portal WHERE user_id = ?"),
  addPortal: db.prepare("INSERT INTO portal (token,user_id,student_id,updated_at) VALUES (?,?,?,?) " +
                        "ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id, student_id=excluded.student_id, updated_at=excluded.updated_at"),
  portalByToken: db.prepare("SELECT * FROM portal WHERE token = ?"),
  portalOfUser: db.prepare("SELECT * FROM portal WHERE user_id = ?"),

  addPS: db.prepare("INSERT INTO psessions (id,user_id,student_id,expires) VALUES (?,?,?,?)"),
  getPS: db.prepare("SELECT * FROM psessions WHERE id = ?"),

  addFile: db.prepare("INSERT INTO files (id,user_id,student_id,name,mime,size,kind,author,created_at) VALUES (?,?,?,?,?,?,?,?,?)"),
  getFile: db.prepare("SELECT * FROM files WHERE id = ?"),
  filesOf: db.prepare("SELECT * FROM files WHERE user_id = ? AND student_id = ? ORDER BY created_at DESC"),
  photoOf: db.prepare("SELECT * FROM files WHERE user_id = ? AND student_id = ? AND kind = 'photo' ORDER BY created_at DESC LIMIT 1"),
  delFile: db.prepare("DELETE FROM files WHERE id = ? AND user_id = ?"),
  usedBytes: db.prepare("SELECT COALESCE(SUM(size),0) AS n FROM files WHERE user_id = ?"),

  addMsg: db.prepare("INSERT INTO messages (id,user_id,student_id,author,text,file_id,created_at) VALUES (?,?,?,?,?,?,?)"),
  msgsOf: db.prepare("SELECT * FROM messages WHERE user_id = ? AND student_id = ? ORDER BY created_at")
};

/* ---------------------------------------------------------------- файлы --- */
const FILES_DIR = path.join(DATA_DIR, "files");
const MAX_FILE = 15 * 1024 * 1024;        /* один файл */
const MAX_TOTAL = 300 * 1024 * 1024;      /* на преподавателя */
fs.mkdirSync(FILES_DIR, { recursive: true });
const filePath = (userId, id) => path.join(FILES_DIR, userId, id);
/* храним только то, что браузер умеет показать сам, плюс обычные документы */
const MIME_OK = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic",
  "application/pdf", "text/plain",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "audio/mpeg", "audio/mp4", "audio/ogg", "video/mp4"
]);

/* ---------------------------------------------------------------- тарифы --- */
const PLANS = {
  free:   { students: 2,        teachers: 1,  money: false, portal: false, reports: false },
  pro:    { students: 15,       teachers: 1,  money: true,  portal: true,  reports: true },
  studio: { students: Infinity, teachers: 20, money: true,  portal: true,  reports: true }
};
const planOf = (school) => PLANS[school.plan] || PLANS.free;

/* ------------------------------------------------------------ вычисления --- */
/* Те же правила, что и в интерфейсе: занятие списывается, когда проведено. */
function emptyDoc() {
  return { v: 2, lang: "ru", cur: "AMD", teacher: "", defRate: 5000, defDur: 60,
           countNoShow: true, students: [], lessons: [], payments: [], packs: [] };
}
function readDoc(userId) {
  const row = q.getDoc.get(userId);
  if (!row) return { version: 0, doc: emptyDoc() };
  try { return { version: row.version, doc: JSON.parse(row.data) }; }
  catch (e) { return { version: row.version, doc: emptyDoc() }; }
}
const isUsed = (doc, l) => l.status === "done" || (l.status === "no_show" && doc.countNoShow !== false);
function balanceOf(doc, sid) {
  let paid = 0, used = 0;
  for (const p of doc.payments || []) if (p.studentId === sid) paid += +p.lessons || 0;
  for (const l of doc.lessons || []) if (l.studentId === sid && isUsed(doc, l)) used++;
  return paid - used;
}
function activeStudents(doc) { return (doc.students || []).filter((s) => !s.archived); }
const todayISO = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};

/* Проверка документа против тарифа — то, что нельзя доверить браузеру. */
function checkPlan(doc, plan) {
  const n = activeStudents(doc).length;
  if (n > plan.students)
    return { code: 402, error: "plan_students", limit: plan.students, have: n };
  if (!plan.money && ((doc.payments || []).length || (doc.packs || []).length))
    return { code: 402, error: "plan_money" };
  return null;
}

/* -------------------------------------------------------- вспомогательное --- */
const uid = () => crypto.randomBytes(9).toString("base64url");
const now = () => Date.now();
const normEmail = (e) => String(e || "").trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

function send(res, code, body, headers) {
  const data = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(code, Object.assign({
    "Content-Type": typeof body === "string" ? "text/html; charset=utf-8" : "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin"
  }, headers || {}));
  res.end(data);
}
function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("too_large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch (e) { reject(new Error("bad_json")); }
    });
    req.on("error", reject);
  });
}
function cookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
const secureReq = (req) => (req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";

/* Простая защита от перебора: попытки на email и на IP. */
const hits = new Map();
function rateLimit(key, max, windowMs) {
  const t = now(), e = hits.get(key);
  if (!e || t > e.reset) { hits.set(key, { n: 1, reset: t + windowMs }); return true; }
  if (e.n >= max) return false;
  e.n++; return true;
}
setInterval(() => { const t = now(); for (const [k, v] of hits) if (t > v.reset) hits.delete(k); }, 60000).unref();

function sessionUser(req) {
  const sid = cookies(req).sid;
  if (!sid) return null;
  const s = q.getSession.get(sid);
  if (!s || s.expires < now()) { if (s) q.delSession.run(sid); return null; }
  return q.userById.get(s.user_id) || null;
}

function portalSession(req) {
  const psid = cookies(req).psid;
  if (!psid) return null;
  const row = q.getPS.get(psid);
  if (!row || row.expires < now()) return null;
  return row;
}
/* доступ к файлу: либо преподаватель-владелец, либо ученик из своего кабинета */
function canReadFile(req, file) {
  const u = sessionUser(req);
  if (u && u.id === file.user_id) return true;
  const ps = portalSession(req);
  return !!(ps && ps.user_id === file.user_id && ps.student_id === file.student_id);
}

/* Ссылки кабинета: токен на ученика, пересобирается при каждом сохранении. */
function rebuildPortal(user, doc, plan) {
  q.clearPortal.run(user.id);
  if (!plan.portal) return {};
  const map = {};
  for (const s of activeStudents(doc)) {
    const token = hmac(user.id + ":" + s.id).slice(0, 24);
    q.addPortal.run(token, user.id, s.id, now());
    map[s.id] = token;
  }
  return map;
}
function portalMap(user) {
  const map = {};
  for (const r of q.portalOfUser.all(user.id)) map[r.student_id] = r.token;
  return map;
}

/* ------------------------------------------------------------------ роуты --- */
const routes = {
  /* --- вход --- */
  "POST /api/auth/request": async (req, res) => {
    const body = await readBody(req);
    const email = normEmail(body.email);
    if (!validEmail(email)) return send(res, 400, { error: "bad_email" });
    const ip = req.socket.remoteAddress || "?";
    if (!rateLimit("req:" + ip, 20, 10 * 60000) || !rateLimit("req:" + email, 5, 10 * 60000))
      return send(res, 429, { error: "too_many" });

    /* Вход и регистрация — разные вещи, и ошибиться в них не страшно:
       на входе с незнакомого адреса зовём регистрироваться, а на регистрации
       со знакомого — входить. Молча заводить аккаунт по опечатке не будем. */
    const signup = body.mode === "signup";
    const name = String(body.name || "").trim().slice(0, 80);
    let user = q.userByEmail.get(email);
    if (user && signup) return send(res, 409, { error: "exists" });
    if (!user && !signup) return send(res, 404, { error: "no_account" });
    if (!user) {
      if (name.length < 2) return send(res, 400, { error: "bad_name" });
      /* новый преподаватель заводит свою школу и становится её владельцем */
      const schoolId = uid();
      q.addSchool.run(schoolId, name, "free", now());
      user = { id: uid(), school_id: schoolId, email, name, role: "owner", created_at: now() };
      q.addUser.run(user.id, schoolId, email, name, "owner", now());
    } else if (name && !user.name) {
      q.setUserName.run(name, user.id);
    }
    const code = String(crypto.randomInt(100000, 1000000));
    q.putCode.run(email, hmac(code), now() + 10 * 60000);

    let sent = false;
    try {
      const letter = mail.codeLetter(code);
      sent = await mail.send({ to: email, subject: letter.subject, text: letter.text });
    } catch (e) {
      /* письмо не ушло — аккаунт уже заведён, но войти человек не сможет:
         честно отвечаем ошибкой, а код остаётся в логе сервера */
      console.error(`[slate] письмо на ${email} не ушло:`, e.message);
      console.log(`[slate] код входа для ${email}: ${code}`);
      return send(res, 502, { error: "mail_failed" });
    }
    if (!sent) console.log(`[slate] код входа для ${email}: ${code}`);
    send(res, 200, DEV_CODES ? { ok: true, devCode: code, mailed: sent } : { ok: true, mailed: sent });
  },

  "POST /api/auth/verify": async (req, res) => {
    const body = await readBody(req);
    const email = normEmail(body.email), code = String(body.code || "").trim();
    const row = q.getCode.get(email);
    if (!row || row.expires < now()) return send(res, 400, { error: "code_expired" });
    if (row.tries >= 5) return send(res, 429, { error: "too_many" });
    q.bumpTries.run(email);
    const a = Buffer.from(hmac(code)), b = Buffer.from(row.code_hash || "");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return send(res, 400, { error: "bad_code" });

    q.dropCode.run(email);
    const user = q.userByEmail.get(email);
    if (!user) return send(res, 400, { error: "no_user" });
    const sid = crypto.randomBytes(24).toString("base64url"), expires = now() + 30 * 24 * 3600 * 1000;
    q.addSession.run(sid, user.id, expires);
    send(res, 200, { ok: true }, {
      "Set-Cookie": `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 3600}` +
                    (secureReq(req) ? "; Secure" : "")
    });
  },

  "POST /api/auth/logout": async (req, res) => {
    const sid = cookies(req).sid;
    if (sid) q.delSession.run(sid);
    send(res, 200, { ok: true }, { "Set-Cookie": "sid=; HttpOnly; Path=/; Max-Age=0" });
  },

  "GET /api/me": async (req, res, user) => {
    if (!user) return send(res, 401, { error: "no_session" });
    const school = q.schoolById.get(user.school_id), plan = planOf(school);
    const { doc } = readDoc(user.id);
    send(res, 200, {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      school: { id: school.id, name: school.name, plan: school.plan },
      limits: { students: plan.students === Infinity ? null : plan.students, teachers: plan.teachers,
                money: plan.money, portal: plan.portal, reports: plan.reports },
      usage: { students: activeStudents(doc).length,
               teachers: q.usersOfSchool.all(user.school_id).length }
    });
  },

  /* --- данные преподавателя --- */
  "GET /api/state": async (req, res, user) => {
    if (!user) return send(res, 401, { error: "no_session" });
    const { version, doc } = readDoc(user.id);
    const plan = planOf(q.schoolById.get(user.school_id));
    let portal = portalMap(user);
    /* ссылки на кабинеты должны быть готовы к первому же открытию карточки */
    if (plan.portal && Object.keys(portal).length !== activeStudents(doc).length)
      portal = rebuildPortal(user, doc, plan);
    const feed = q.feedOf.get(user.id);
    send(res, 200, { version, doc, portal,
                     busy: feed ? { name: feed.name, events: safeJson(feed.events) } : null });
  },

  "PUT /api/state": async (req, res, user) => {
    if (!user) return send(res, 401, { error: "no_session" });
    const body = await readBody(req);
    const doc = body.doc;
    if (!doc || !Array.isArray(doc.students)) return send(res, 400, { error: "bad_doc" });

    const cur = readDoc(user.id);
    if (typeof body.version === "number" && body.version !== cur.version)
      return send(res, 409, { error: "stale", version: cur.version, doc: cur.doc });

    const school = q.schoolById.get(user.school_id), plan = planOf(school);
    const bad = checkPlan(doc, plan);
    if (bad) return send(res, bad.code, bad);

    const version = cur.version + 1;
    q.putDoc.run(user.id, version, JSON.stringify(doc), now());
    const portal = rebuildPortal(user, doc, plan);
    send(res, 200, { ok: true, version, portal });
  },

  /* --- школа: только владелец --- */
  "GET /api/school": async (req, res, user) => {
    if (!user) return send(res, 401, { error: "no_session" });
    if (user.role !== "owner") return send(res, 403, { error: "not_owner" });
    const school = q.schoolById.get(user.school_id);
    const month = todayISO().slice(0, 7);
    const teachers = q.usersOfSchool.all(user.school_id).map((u) => {
      const { doc } = readDoc(u.id);
      let held = 0, income = {};
      for (const l of doc.lessons || []) if (l.date && l.date.slice(0, 7) === month && isUsed(doc, l)) held++;
      for (const p of doc.payments || []) {
        if (p.date && p.date.slice(0, 7) === month) {
          const c = p.currency || doc.cur || "AMD";
          income[c] = (income[c] || 0) + (+p.amount || 0);
        }
      }
      return { id: u.id, email: u.email, name: u.name || "", role: u.role,
               students: activeStudents(doc).length, held, income };
    });
    send(res, 200, { school: { id: school.id, name: school.name, plan: school.plan }, teachers, month });
  },

  "POST /api/school/teachers": async (req, res, user) => {
    if (!user) return send(res, 401, { error: "no_session" });
    if (user.role !== "owner") return send(res, 403, { error: "not_owner" });
    const school = q.schoolById.get(user.school_id), plan = planOf(school);
    const have = q.usersOfSchool.all(user.school_id).length;
    if (have >= plan.teachers) return send(res, 402, { error: "plan_teachers", limit: plan.teachers, have });

    const body = await readBody(req);
    const email = normEmail(body.email);
    if (!validEmail(email)) return send(res, 400, { error: "bad_email" });
    if (q.userByEmail.get(email)) return send(res, 409, { error: "email_taken" });

    const id = uid();
    q.addUser.run(id, user.school_id, email, String(body.name || "").slice(0, 80), "teacher", now());
    send(res, 200, { ok: true, teacher: { id, email, name: body.name || "", role: "teacher" } });
  },

  "POST /api/school/teachers/remove": async (req, res, user) => {
    if (!user) return send(res, 401, { error: "no_session" });
    if (user.role !== "owner") return send(res, 403, { error: "not_owner" });
    const body = await readBody(req);
    if (body.id === user.id) return send(res, 400, { error: "self" });
    q.delUser.run(String(body.id || ""), user.school_id);
    send(res, 200, { ok: true });
  },

  /* Смена тарифа. Пока без оплаты — переключается вручную, чтобы можно было
     проверить лимиты. Здесь же потом появится биллинг. */
  /* --- телеграм: ссылка для привязки и отключение --- */
  "POST /api/telegram/link": async (req, res, user) => {
    if (!user) return send(res, 401, { error: "no_session" });
    if (!bot.enabled()) return send(res, 503, { error: "no_bot" });
    const code = bot.makeCode(botCtx.q, { kind: "teacher", userId: user.id });
    send(res, 200, { ok: true, url: `https://t.me/${botCtx.botName}?start=${code}`, bot: botCtx.botName });
  },

  "GET /api/telegram": async (req, res, user) => {
    if (!user) return send(res, 401, { error: "no_session" });
    const chats = botCtx.q.chatsOf.all(user.id, "teacher");
    const students = {};
    for (const row of botCtx.q.chatsOf.all(user.id, "student")) students[row.student_id] = row.name || true;
    send(res, 200, { enabled: bot.enabled(), bot: botCtx.botName, linked: chats.length > 0, students });
  },

  "POST /api/telegram/off": async (req, res, user) => {
    if (!user) return send(res, 401, { error: "no_session" });
    for (const row of botCtx.q.chatsOf.all(user.id, "teacher")) botCtx.q.unlink.run(row.chat_id);
    send(res, 200, { ok: true });
  },

  "POST /api/portal/telegram": async (req, res) => {
    const ps = portalSession(req);
    if (!ps) return send(res, 401, { error: "no_session" });
    if (!bot.enabled()) return send(res, 503, { error: "no_bot" });
    const code = bot.makeCode(botCtx.q, { kind: "student", userId: ps.user_id, studentId: ps.student_id });
    send(res, 200, { ok: true, url: `https://t.me/${botCtx.botName}?start=${code}`, bot: botCtx.botName });
  },

  /* --- календарь: наружу подпиской, внутрь по ссылке --- */
  "GET /api/calendar": async (req, res, user) => {
    if (!user) return send(res, 401, { error: "no_session" });
    let row = q.icsOf.get(user.id);
    if (!row) { const token = crypto.randomBytes(18).toString("base64url"); q.setIcs.run(user.id, token, now()); row = q.icsOf.get(user.id); }
    const feed = q.feedOf.get(user.id);
    send(res, 200, {
      url: `${publicBase(req)}/ics/${row.token}.ics`,
      feed: feed ? { url: feed.url, name: feed.name, fetched_at: feed.fetched_at, error: feed.error,
                     events: safeJson(feed.events).length } : null,
    });
  },

  "POST /api/calendar/reset": async (req, res, user) => {
    if (!user) return send(res, 401, { error: "no_session" });
    const token = crypto.randomBytes(18).toString("base64url");
    q.setIcs.run(user.id, token, now());
    send(res, 200, { ok: true, url: `${publicBase(req)}/ics/${token}.ics` });
  },

  /* подключаем чужой календарь: сразу читаем его, чтобы ошибка была видна */
  "POST /api/calendar/feed": async (req, res, user) => {
    if (!user) return send(res, 401, { error: "no_session" });
    const body = await readBody(req);
    const raw = String(body.url || "").trim();
    if (!raw) { q.dropFeed.run(user.id); return send(res, 200, { ok: true, feed: null }); }
    const url = raw.replace(/^webcal:\/\//i, "https://");
    /* webcal:// уже превратили в https://; обычный http тоже принимаем —
       календарные ленты публичны, и не все отдаются по https */
    if (!/^https?:\/\//i.test(url)) return send(res, 400, { error: "bad_url" });
    const result = await pullFeed(user.id, url);
    if (result.error) return send(res, 502, { error: "fetch_failed", detail: result.error });
    send(res, 200, { ok: true, feed: { url, name: result.name, events: result.events.length } });
  },

  /* --- админка сервиса --- */
  "GET /api/admin": async (req, res, user) => {
    /* «не вошёл» и «вошёл, но не хозяин» — разные ответы: страница
       по первому предлагает войти, по второму объясняет про права */
    if (!user) return send(res, 401, { error: "no_session" });
    if (!isAdmin(user)) return send(res, 403, { error: "not_admin" });
    const schools = [];
    for (const school of q.allSchools.all()) {
      const people = q.usersOfSchool.all(school.id);
      let students = 0, lessons = 0, updated = 0;
      for (const u of people) {
        const row = q.getDoc.get(u.id);
        if (!row) continue;
        updated = Math.max(updated, row.updated_at || 0);
        try {
          const doc = JSON.parse(row.data);
          students += activeStudents(doc).length;
          lessons += (doc.lessons || []).length;
        } catch (e) { /* испорченный документ не должен ронять админку */ }
      }
      let files = 0, bytes = 0, msgs = 0;
      for (const u of people) {
        const f = q.countFiles.get(u.id);
        files += f.n; bytes += f.bytes;
        msgs += q.countMsgs.get(u.id).n;
      }
      schools.push({
        id: school.id, name: school.name, plan: school.plan, created_at: school.created_at,
        students, lessons, files, bytes, msgs, updated_at: updated,
        mine: school.id === user.school_id,
        people: people.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role,
                                     created_at: u.created_at,
                                     telegram: botCtx.q.chatsOf.all(u.id, "teacher").length > 0 })),
      });
    }
    schools.sort((a, b) => (b.updated_at || b.created_at) - (a.updated_at || a.created_at));
    send(res, 200, {
      you: user.email,
      plans: Object.keys(PLANS),
      mail: mail.configured() ? mail.PROVIDER : null,
      telegram: bot.enabled(),
      schools,
    });
  },

  "POST /api/admin/plan": async (req, res, user) => {
    if (!user) return send(res, 401, { error: "no_session" });
    if (!isAdmin(user)) return send(res, 403, { error: "not_admin" });
    const body = await readBody(req);
    const plan = String(body.plan || "");
    if (!PLANS[plan]) return send(res, 400, { error: "bad_plan" });
    const school = q.schoolById.get(String(body.schoolId || ""));
    if (!school) return send(res, 404, { error: "no_school" });
    q.setPlan.run(plan, school.id);
    /* кабинеты учеников появляются и исчезают вместе с тарифом */
    for (const u of q.usersOfSchool.all(school.id)) {
      rebuildPortal(u, readDoc(u.id).doc, PLANS[plan]);
    }
    send(res, 200, { ok: true, plan });
  },

  "POST /api/admin/delete": async (req, res, user) => {
    if (!user) return send(res, 401, { error: "no_session" });
    if (!isAdmin(user)) return send(res, 403, { error: "not_admin" });
    const body = await readBody(req);
    const school = q.schoolById.get(String(body.schoolId || ""));
    if (!school) return send(res, 404, { error: "no_school" });
    /* свою школу не удаляем: так легко остаться без входа */
    if (school.id === user.school_id) return send(res, 400, { error: "self" });

    const people = q.usersOfSchool.all(school.id);
    /* подтверждение — почта владельца: случайным нажатием не сотрёшь */
    const owner = (people.find((p) => p.role === "owner") || people[0] || {}).email || "";
    if (String(body.confirm || "").trim().toLowerCase() !== owner.toLowerCase())
      return send(res, 400, { error: "confirm", owner });

    let files = 0;
    for (const u of people) {
      files += q.countFiles.get(u.id).n;
      try { fs.rmSync(path.join(FILES_DIR, u.id), { recursive: true, force: true }); } catch (e) {}
      q.wipeFiles.run(u.id); q.wipeMsgs.run(u.id); q.wipeDoc.run(u.id);
      q.wipePortal.run(u.id); q.wipePS.run(u.id); q.wipeSessions.run(u.id);
      for (const row of botCtx.q.chatsOf.all(u.id, "teacher")) botCtx.q.unlink.run(row.chat_id);
      for (const row of botCtx.q.chatsOf.all(u.id, "student")) botCtx.q.unlink.run(row.chat_id);
      q.wipeUser.run(u.id);
    }
    q.wipeSchool.run(school.id);
    console.log(`[slate] админ ${user.email} удалил школу ${owner} (людей: ${people.length}, файлов: ${files})`);
    send(res, 200, { ok: true, people: people.length, files });
  },

  "POST /api/school/plan": async (req, res, user) => {
    if (!user) return send(res, 401, { error: "no_session" });
    if (user.role !== "owner") return send(res, 403, { error: "not_owner" });
    const body = await readBody(req);
    const plan = String(body.plan || "");
    if (!PLANS[plan]) return send(res, 400, { error: "bad_plan" });
    q.setPlan.run(plan, user.school_id);
    /* смена тарифа сразу отражается на кабинетах: на Pro они появляются,
       на бесплатном — исчезают, ждать следующего сохранения не нужно */
    const { doc } = readDoc(user.id);
    const portal = rebuildPortal(user, doc, PLANS[plan]);
    send(res, 200, { ok: true, plan, portal });
  },

  /* --- кабинет ученика: без сессии, по токену и коду --- */
  "POST /api/portal": async (req, res) => {
    const body = await readBody(req);
    const token = String(body.token || ""), code = String(body.code || "").trim();
    const ip = req.socket.remoteAddress || "?";
    if (!rateLimit("portal:" + ip, 40, 10 * 60000)) return send(res, 429, { error: "too_many" });

    const row = q.portalByToken.get(token);
    if (!row) return send(res, 404, { error: "no_portal" });
    const user = q.userById.get(row.user_id);
    const { doc } = readDoc(row.user_id);
    const s = (doc.students || []).find((x) => x.id === row.student_id);
    if (!user || !s) return send(res, 404, { error: "no_portal" });
    if (String(s.code || "") !== code) return send(res, 403, { error: "bad_code" });

    const psid = crypto.randomBytes(24).toString("base64url");
    q.addPS.run(psid, row.user_id, s.id, now() + 7 * 24 * 3600 * 1000);
    const setCookie = `psid=${psid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 3600}` +
                      (secureReq(req) ? "; Secure" : "");

    const td = todayISO();
    const upcoming = (doc.lessons || [])
      .filter((l) => l.studentId === s.id && l.date >= td && l.status === "planned")
      .sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1)).slice(0, 6)
      .map((l) => ({ date: l.date, time: l.time, online: !!l.online, hw: l.hw || "", link: l.link || "" }));
    const pack = (doc.packs || []).filter((p) => p.studentId === s.id)
      .sort((a, b) => (a.start < b.start ? 1 : -1))[0] || null;
    const payments = (doc.payments || []).filter((p) => p.studentId === s.id)
      .sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6)
      .map((p) => ({ date: p.date, amount: p.amount, currency: p.currency, lessons: p.lessons }));

    send(res, 200, portalPayload(row.user_id, s, doc, user), { "Set-Cookie": setCookie });
  },

  /* повторный вход в кабинет — уже по cookie, без кода */
  "GET /api/portal/data": async (req, res) => {
    const ps = portalSession(req);
    if (!ps) return send(res, 401, { error: "no_session" });
    const user = q.userById.get(ps.user_id);
    const { doc } = readDoc(ps.user_id);
    const s = (doc.students || []).find((x) => x.id === ps.student_id);
    if (!user || !s) return send(res, 404, { error: "no_portal" });
    send(res, 200, portalPayload(ps.user_id, s, doc, user));
  },

  /* ученик пишет преподавателю */
  "POST /api/portal/message": async (req, res) => {
    const ps = portalSession(req);
    if (!ps) return send(res, 401, { error: "no_session" });
    const body = await readBody(req);
    const text = String(body.text || "").trim().slice(0, 4000);
    if (!text && !body.fileId) return send(res, 400, { error: "empty" });
    const id = uid();
    q.addMsg.run(id, ps.user_id, ps.student_id, "student", text, body.fileId || null, now());
    send(res, 200, { ok: true, id });
    const who = (readDoc(ps.user_id).doc.students || []).find((x) => x.id === ps.student_id);
    bot.notifyMessage(botCtx, { userId: ps.user_id, studentId: ps.student_id, author: "student",
                                text: text || "прислал файл", studentName: who && who.name });
  },

  /* ученик загружает файл или своё фото */
  "POST /api/portal/upload": async (req, res) => {
    const ps = portalSession(req);
    if (!ps) return send(res, 401, { error: "no_session" });
    const body = await readBody(req, 22 * 1024 * 1024);
    return saveUpload(res, ps.user_id, ps.student_id, body, "student");
  },

  "POST /api/portal/logout": async (req, res) => {
    send(res, 200, { ok: true }, { "Set-Cookie": "psid=; HttpOnly; Path=/; Max-Age=0" });
  },

  /* --- файлы и переписка со стороны преподавателя --- */
  "POST /api/files": async (req, res, user) => {
    if (!user) return send(res, 401, { error: "no_session" });
    const school = q.schoolById.get(user.school_id), plan = planOf(school);
    if (!plan.portal) return send(res, 402, { error: "plan_files" });
    const body = await readBody(req, 22 * 1024 * 1024);
    return saveUpload(res, user.id, String(body.studentId || ""), body, "teacher");
  },

  "GET /api/files": async (req, res, user) => {
    if (!user) return send(res, 401, { error: "no_session" });
    const sid = new URL(req.url, "http://x").searchParams.get("studentId") || "";
    send(res, 200, {
      files: q.filesOf.all(user.id, sid).map(fileRow),
      used: q.usedBytes.get(user.id).n, quota: MAX_TOTAL
    });
  },

  "POST /api/files/delete": async (req, res, user) => {
    if (!user) return send(res, 401, { error: "no_session" });
    const body = await readBody(req);
    const f = q.getFile.get(String(body.id || ""));
    if (!f || f.user_id !== user.id) return send(res, 404, { error: "not_found" });
    q.delFile.run(f.id, user.id);
    fs.unlink(filePath(user.id, f.id), () => {});
    send(res, 200, { ok: true });
  },

  "GET /api/messages": async (req, res, user) => {
    if (!user) return send(res, 401, { error: "no_session" });
    const sid = new URL(req.url, "http://x").searchParams.get("studentId") || "";
    send(res, 200, { messages: q.msgsOf.all(user.id, sid).map(msgRow) });
  },

  "POST /api/messages": async (req, res, user) => {
    if (!user) return send(res, 401, { error: "no_session" });
    const school = q.schoolById.get(user.school_id), plan = planOf(school);
    if (!plan.portal) return send(res, 402, { error: "plan_files" });
    const body = await readBody(req);
    const text = String(body.text || "").trim().slice(0, 4000);
    if (!text && !body.fileId) return send(res, 400, { error: "empty" });
    const id = uid();
    const sid = String(body.studentId || "");
    q.addMsg.run(id, user.id, sid, "teacher", text, body.fileId || null, now());
    send(res, 200, { ok: true, id });
    /* ученику в телеграм — уже после ответа, чтобы не задерживать отправку */
    bot.notifyMessage(botCtx, { userId: user.id, studentId: sid, author: "teacher",
                                text: text || "прислал файл", teacherName: user.name });
  },

};

/* ---- общие куски для файлов и кабинета ---- */
function fileRow(f) {
  return { id: f.id, name: f.name, mime: f.mime, size: f.size, kind: f.kind,
           author: f.author, created: f.created_at, url: "/api/file/" + f.id };
}
function msgRow(m) {
  const f = m.file_id ? q.getFile.get(m.file_id) : null;
  return { id: m.id, author: m.author, text: m.text || "", created: m.created_at,
           file: f ? fileRow(f) : null };
}
function saveUpload(res, userId, studentId, body, author) {
  const name = String(body.name || "file").slice(0, 200);
  const mime = String(body.mime || "application/octet-stream");
  const kind = body.kind === "photo" ? "photo" : "file";
  if (!MIME_OK.has(mime)) return send(res, 415, { error: "bad_type", mime });
  let buf;
  try { buf = Buffer.from(String(body.data || ""), "base64"); }
  catch (e) { return send(res, 400, { error: "bad_data" }); }
  if (!buf.length) return send(res, 400, { error: "empty" });
  if (buf.length > MAX_FILE) return send(res, 413, { error: "too_large", max: MAX_FILE });
  const used = q.usedBytes.get(userId).n;
  if (used + buf.length > MAX_TOTAL) return send(res, 413, { error: "quota", used, quota: MAX_TOTAL });

  const id = uid();
  fs.mkdirSync(path.join(FILES_DIR, userId), { recursive: true });
  fs.writeFileSync(filePath(userId, id), buf);
  q.addFile.run(id, userId, studentId, name, mime, buf.length, kind, author, now());
  send(res, 200, { ok: true, file: fileRow(q.getFile.get(id)) });
}
function portalPayload(userId, s, doc, user) {
  const td = todayISO();
  const upcoming = (doc.lessons || [])
    .filter((l) => l.studentId === s.id && l.date >= td && l.status === "planned")
    .sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1)).slice(0, 6)
    .map((l) => ({ date: l.date, time: l.time, online: !!l.online, hw: l.hw || "", link: l.link || "" }));
  const pack = (doc.packs || []).filter((p) => p.studentId === s.id)
    .sort((a, b) => (a.start < b.start ? 1 : -1))[0] || null;
  const payments = (doc.payments || []).filter((p) => p.studentId === s.id)
    .sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6)
    .map((p) => ({ date: p.date, amount: p.amount, currency: p.currency, lessons: p.lessons }));
  const photo = q.photoOf.get(userId, s.id);
  return {
    student: { name: s.name, subject: s.subject || "", level: s.level || "" },
    teacher: doc.teacher || (user && user.name) || "",
    lang: doc.lang || "ru",
    balance: balanceOf(doc, s.id),
    packUntil: pack ? pack.last : null,
    upcoming, payments,
    photo: photo ? fileRow(photo) : null,
    files: q.filesOf.all(userId, s.id).filter((f) => f.kind !== "photo").map(fileRow),
    messages: q.msgsOf.all(userId, s.id).map(msgRow),
    links: String(s.links || "").split("\n").map((line) => {
      const i = line.indexOf("|");
      const title = i < 0 ? line.trim() : line.slice(0, i).trim();
      const url = i < 0 ? line.trim() : line.slice(i + 1).trim();
      return url ? { title: title || url, url } : null;
    }).filter(Boolean)
  };
}

/* ------------------------------------------------------------- статика ---- */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
               ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
               ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
function serveFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: "not_found" });
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
                         "Content-Length": data.length, "Cache-Control": "no-cache" });
    res.end(data);
  });
}

/* -------------------------------------------------------------- сервер ---- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;

  try {
    /* файл: преподавателю — свой, ученику — только свой из кабинета */
    if (p.startsWith("/api/file/")) {
      const f = q.getFile.get(p.slice("/api/file/".length));
      if (!f) return send(res, 404, { error: "not_found" });
      if (!canReadFile(req, f)) return send(res, 403, { error: "forbidden" });
      return fs.readFile(filePath(f.user_id, f.id), (err, data) => {
        if (err) return send(res, 404, { error: "not_found" });
        res.writeHead(200, {
          "Content-Type": f.mime || "application/octet-stream",
          "Content-Length": data.length,
          "Content-Disposition": "inline; filename*=UTF-8''" + encodeURIComponent(f.name || "file"),
          "Cache-Control": "private, max-age=86400",
          "X-Content-Type-Options": "nosniff"
        });
        res.end(data);
      });
    }

    /* кабинет ученика: /s/<token> */
    if (p.startsWith("/ics/")) {
      const token = p.slice(5).replace(/\.ics$/i, "");
      const row = q.icsByToken.get(token);
      if (!row) return send(res, 404, { error: "no_calendar" });
      const owner = q.userById.get(row.user_id);
      const { doc } = readDoc(row.user_id);
      const cal = ics.calendar(doc, { name: "Slate" + (owner && owner.name ? " — " + owner.name : "") });
      res.writeHead(200, {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="slate.ics"',
        "Cache-Control": "no-cache",
      });
      return res.end(cal.text);
    }
    if (p.startsWith("/s/")) return serveFile(res, path.join(PUBLIC_DIR, "portal.html"));
    /* корень — страница продукта, программа живёт на /app */
    if (p === "/") return serveFile(res, path.join(PUBLIC_DIR, "landing.html"));
    if (p === "/app" || p === "/app/") return serveFile(res, path.join(PUBLIC_DIR, "index.html"));
    if (p === "/admin" || p === "/admin/") return serveFile(res, path.join(PUBLIC_DIR, "admin.html"));

    const key = req.method + " " + p;
    if (routes[key]) return await routes[key](req, res, sessionUser(req));

    if (p.startsWith("/api/")) return send(res, 404, { error: "not_found" });

    /* статика */
    const rel = p.replace(/^\/+/, "");
    const file = path.join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: "forbidden" });
    return serveFile(res, file);
  } catch (e) {
    const msg = e && e.message === "too_large" ? "too_large" : e && e.message === "bad_json" ? "bad_json" : "server_error";
    if (msg === "server_error") console.error("[slate]", e);
    send(res, msg === "server_error" ? 500 : 400, { error: msg });
  }
});

/* адрес в домашней сети: по нему Slate открывается с телефона и планшета */
function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return null;
}

const safeJson = (text) => { try { return JSON.parse(text || "[]"); } catch (e) { return []; } };

/* Адрес, по которому нас видно снаружи: за Caddy приходит x-forwarded-*. */
function publicBase(req) {
  const proto = (req.headers["x-forwarded-proto"] || "").split(",")[0].trim() ||
                (secureReq(req) ? "https" : "http");
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "localhost").split(",")[0].trim();
  return `${proto}://${host}`;
}

/* Забираем чужой календарь и складываем разобранные события в базу. */
async function pullFeed(userId, url) {
  try {
    const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20000),
                                 headers: { "user-agent": "Slate/1.0 calendar" } });
    if (!r.ok) throw new Error("ответ " + r.status);
    const text = await r.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("по ссылке не календарь");
    const parsed = ics.parse(text);
    q.setFeed.run(userId, url, parsed.name || "Мой календарь", JSON.stringify(parsed.events), now(), null);
    return { name: parsed.name, events: parsed.events };
  } catch (e) {
    const why = (e.cause && e.cause.code) || e.message;
    q.setFeed.run(userId, url, null, JSON.stringify([]), now(), String(why).slice(0, 200));
    return { error: String(why).slice(0, 200), events: [] };
  }
}

/* Раз в четверть часа перечитываем подключённые календари. */
function refreshFeeds() {
  for (const row of db.prepare("SELECT user_id, url FROM feeds").all()) {
    pullFeed(row.user_id, row.url).catch(() => {});
  }
}
setInterval(refreshFeeds, 15 * 60000).unref();

/* всё, что нужно боту: свои таблицы, документы преподавателей и лог */
const botCtx = {
  q: bot.makeQueries(db),
  readDoc,
  allUsers: () => q.allUsers.all(),
  busyOf: (userId) => {
    const feed = q.feedOf.get(userId);
    return feed ? safeJson(feed.events) : [];
  },
  log: (m) => console.log("[slate/бот]", m),
  botName: "",
};

server.listen(PORT, () => {
  console.log(`[slate] сервер на http://localhost:${PORT}`);
  const lan = lanAddress();
  if (lan) console.log(`[slate] с телефона и планшета в той же сети: http://${lan}:${PORT}`);
  console.log(`[slate] данные в ${DATA_DIR}`);
  console.log(mail.configured()
    ? `[slate] письма через ${mail.PROVIDER}, отправитель ${mail.FROM}`
    : "[slate] почта не настроена — коды входа видны на экране и в логе (см. README)");
  if (DEV_CODES && mail.configured()) console.log("[slate] код входа всё ещё показывается на экране: SLATE_DEV_CODES=1");
  bot.start(botCtx);
});

module.exports = server;
