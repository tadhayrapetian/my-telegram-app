/* =============================================================================
   Телеграм: напоминания ученикам и сводка преподавателю.

   Почему Telegram, а не письма и не push: доходит мгновенно, бесплатно,
   стоит у всех, и — что важно на нашем этапе — работает без домена и без
   белого IP. Бот сам ходит за сообщениями (long polling), поэтому Slate
   может стоять хоть на ноутбуке.

   Подключение: создайте бота у @BotFather, положите токен в slate.env:
       SLATE_BOT_TOKEN=123456:AA...
   Преподаватель нажимает «Подключить Telegram» в настройках, ученик —
   в своём кабинете; кнопка даёт ссылку вида t.me/ваш_бот?start=КОД.

   Что шлём:
     ученику    — напоминание накануне вечером и за два часа до занятия,
                  сообщение от преподавателя, «остался один урок»;
     преподавателю — расписание на сегодня утром, сообщение от ученика,
                  вчерашние неотмеченные занятия.
   ========================================================================== */

const crypto = require("node:crypto");

const TOKEN = (process.env.SLATE_BOT_TOKEN || "").trim();
/* адрес API вынесен ради тестов: в них поднимается поддельный Telegram */
const API = (process.env.SLATE_TG_API || "https://api.telegram.org").replace(/\/+$/, "");

const enabled = () => !!TOKEN;

/* ------------------------------------------------------------------ обмен --- */

async function call(method, payload) {
  let res;
  try {
    res = await fetch(`${API}/bot${TOKEN}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(65000),
    });
  } catch (e) {
    /* «fetch failed» само по себе ничего не объясняет — достаём причину:
       ENOTFOUND — не резолвится, ETIMEDOUT/ECONNRESET — режет сеть или
       блокировка, ECONNREFUSED — некуда стучаться */
    const cause = (e && e.cause) || {};
    const why = cause.code || cause.message || e.message;
    throw new Error(`${method}: сеть — ${why} (адрес ${API})`);
  }
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(`${method}: ${data.description || res.status}`);
  return data.result;
}

async function sendMessage(chatId, text) {
  return call("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
}

/* --------------------------------------------------------------- хранение --- */

function schema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tg (
      chat_id    TEXT PRIMARY KEY,
      kind       TEXT NOT NULL,          -- teacher | student
      user_id    TEXT NOT NULL,
      student_id TEXT,
      name       TEXT,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS tg_codes (
      code       TEXT PRIMARY KEY,
      kind       TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      student_id TEXT,
      expires    INTEGER
    );
    CREATE TABLE IF NOT EXISTS tg_sent (
      key        TEXT PRIMARY KEY,       -- что именно отправлено, чтобы не слать дважды
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS tg_state (
      key TEXT PRIMARY KEY, value TEXT
    );
    CREATE INDEX IF NOT EXISTS tg_user ON tg(user_id, kind);
  `);
}

function makeQueries(db) {
  return {
    link:       db.prepare("INSERT INTO tg (chat_id,kind,user_id,student_id,name,created_at) VALUES (?,?,?,?,?,?) " +
                           "ON CONFLICT(chat_id) DO UPDATE SET kind=excluded.kind, user_id=excluded.user_id, " +
                           "student_id=excluded.student_id, name=excluded.name"),
    unlink:     db.prepare("DELETE FROM tg WHERE chat_id = ?"),
    chatsOf:    db.prepare("SELECT * FROM tg WHERE user_id = ? AND kind = ?"),
    chatOfStudent: db.prepare("SELECT * FROM tg WHERE user_id = ? AND student_id = ? AND kind = 'student'"),
    byChat:     db.prepare("SELECT * FROM tg WHERE chat_id = ?"),

    putCode:    db.prepare("INSERT INTO tg_codes (code,kind,user_id,student_id,expires) VALUES (?,?,?,?,?) " +
                           "ON CONFLICT(code) DO UPDATE SET expires=excluded.expires"),
    getCode:    db.prepare("SELECT * FROM tg_codes WHERE code = ?"),
    dropCode:   db.prepare("DELETE FROM tg_codes WHERE code = ?"),

    wasSent:    db.prepare("SELECT 1 AS yes FROM tg_sent WHERE key = ?"),
    markSent:   db.prepare("INSERT OR IGNORE INTO tg_sent (key,created_at) VALUES (?,?)"),
    cleanSent:  db.prepare("DELETE FROM tg_sent WHERE created_at < ?"),

    getState:   db.prepare("SELECT value FROM tg_state WHERE key = ?"),
    setState:   db.prepare("INSERT INTO tg_state (key,value) VALUES (?,?) " +
                           "ON CONFLICT(key) DO UPDATE SET value=excluded.value"),
  };
}

/* ------------------------------------------------------------------ время --- */

const pad = (n) => String(n).padStart(2, "0");
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return isoDay(d); };
/* момент занятия по местному времени сервера */
const at = (iso, time) => new Date(`${iso}T${(time || "00:00")}:00`).getTime();

const MONTHS = ["января","февраля","марта","апреля","мая","июня",
                "июля","августа","сентября","октября","ноября","декабря"];
function human(iso) {
  const d = new Date(iso + "T00:00:00");
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/* --------------------------------------------------------------- рассылка --- */

/* Один проход: смотрим на документы всех преподавателей и шлём то,
   чему пришло время. Всё, что отправлено, помечаем — повторов не будет. */
async function tick(ctx) {
  const { q, readDoc, allUsers, log } = ctx;
  const nowMs = Date.now();
  const today = isoDay(new Date());
  const send = async (chatId, text, key) => {
    if (q.wasSent.get(key)) return false;
    try {
      await sendMessage(chatId, text);
      q.markSent.run(key, nowMs);
      return true;
    } catch (e) {
      log(`не отправилось (${key}): ${e.message}`);
      /* чат удалён или бот заблокирован — больше не пытаемся */
      if (/blocked|chat not found|deactivated/i.test(e.message)) q.unlink.run(chatId);
      return false;
    }
  };

  let sent = 0;
  for (const user of allUsers()) {
    const teachers = q.chatsOf.all(user.id, "teacher");
    const doc = readDoc(user.id).doc || {};
    const students = doc.students || [];
    const lessons = doc.lessons || [];
    const nameOf = (id) => (students.find((s) => s.id === id) || {}).name || "ученик";

    /* --- преподавателю: расписание на сегодня, одним сообщением утром --- */
    if (teachers.length) {
      const mine = lessons
        .filter((l) => l.date === today && l.status === "planned")
        .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
      const hour = new Date().getHours();
      if (hour >= 7 && mine.length) {
        const text = `Сегодня, ${human(today)} — занятий: ${mine.length}\n\n` +
          mine.map((l) => `${l.time}  ${nameOf(l.studentId)}`).join("\n");
        for (const t of teachers) if (await send(t.chat_id, text, `agenda:${user.id}:${today}`)) sent++;
      }
      /* вчерашние неотмеченные */
      const yesterday = addDays(today, -1);
      const unmarked = lessons.filter((l) => l.date === yesterday && l.status === "planned");
      if (hour >= 10 && unmarked.length) {
        const text = `Вчера остались неотмеченные занятия: ${unmarked.length}\n` +
          unmarked.map((l) => `• ${l.time} ${nameOf(l.studentId)}`).join("\n") +
          `\n\nОтметьте их в разделе «Расписание», иначе абонементы посчитаются неверно.`;
        for (const t of teachers) if (await send(t.chat_id, text, `unmarked:${user.id}:${yesterday}`)) sent++;
      }
    }

    /* --- ученику: напоминания о занятиях --- */
    for (const s of students) {
      const chat = q.chatOfStudent.get(user.id, s.id);
      if (!chat) continue;
      const upcoming = lessons.filter((l) => l.studentId === s.id && l.status === "planned" &&
                                             (l.date === today || l.date === addDays(today, 1)));
      for (const l of upcoming) {
        const when = at(l.date, l.time);
        const left = when - nowMs;
        const where = l.online ? " (онлайн)" : "";
        /* накануне вечером */
        if (l.date === addDays(today, 1) && new Date().getHours() >= 18) {
          const text = `Напоминание: завтра, ${human(l.date)} в ${l.time} — занятие${where}.` +
                       (l.hw ? `\n\nДомашнее задание: ${l.hw}` : "");
          if (await send(chat.chat_id, text, `eve:${user.id}:${l.id}`)) sent++;
        }
        /* за два часа */
        if (left > 0 && left <= 2 * 3600 * 1000) {
          const text = `Через ${Math.max(1, Math.round(left / 60000))} мин — занятие в ${l.time}${where}.` +
                       (l.link ? `\n${l.link}` : "");
          if (await send(chat.chat_id, text, `soon:${user.id}:${l.id}`)) sent++;
        }
      }
    }
  }

  /* отметки старше двух недель не нужны */
  q.cleanSent.run(nowMs - 14 * 24 * 3600 * 1000);
  return sent;
}

/* Сообщение в переписке — шлём сразу, не дожидаясь прохода. */
async function notifyMessage(ctx, { userId, studentId, author, text, studentName, teacherName }) {
  if (!enabled()) return;
  const { q, log } = ctx;
  try {
    if (author === "teacher") {
      const chat = q.chatOfStudent.get(userId, studentId);
      if (chat) await sendMessage(chat.chat_id, `${teacherName || "Преподаватель"}: ${text}`);
    } else {
      for (const t of q.chatsOf.all(userId, "teacher")) {
        await sendMessage(t.chat_id, `${studentName || "Ученик"}: ${text}`);
      }
    }
  } catch (e) {
    log(`сообщение не ушло: ${e.message}`);
  }
}

/* ------------------------------------------------------- приём сообщений --- */

/* Код привязки живёт полчаса: за это время человек успевает нажать кнопку. */
function makeCode(q, { kind, userId, studentId }) {
  const code = crypto.randomBytes(9).toString("base64url");
  q.putCode.run(code, kind, userId, studentId || null, Date.now() + 30 * 60000);
  return code;
}

async function handleUpdate(ctx, update) {
  const { q, botName, log } = ctx;
  const msg = update.message || update.edited_message;
  if (!msg || !msg.chat) return;
  const chatId = String(msg.chat.id);
  const text = String(msg.text || "").trim();
  const who = [msg.from && msg.from.first_name, msg.from && msg.from.last_name].filter(Boolean).join(" ");

  if (text.startsWith("/start")) {
    const code = text.slice(6).trim();
    if (!code) {
      await sendMessage(chatId, "Это бот Slate. Чтобы получать напоминания, откройте Slate " +
        "и нажмите «Подключить Telegram» — кнопка даст ссылку, по которой я вас узнаю.");
      return;
    }
    const row = q.getCode.get(code);
    if (!row || row.expires < Date.now()) {
      await sendMessage(chatId, "Ссылка устарела. Нажмите «Подключить Telegram» в Slate ещё раз.");
      return;
    }
    q.dropCode.run(code);
    q.link.run(chatId, row.kind, row.user_id, row.student_id, who, Date.now());
    await sendMessage(chatId, row.kind === "teacher"
      ? "Готово. Утром буду присылать расписание на день, а вечером — напоминать про неотмеченные занятия.\n\n/stop — отключить."
      : "Готово. Буду напоминать о занятиях накануне вечером и за два часа до начала.\n\n/stop — отключить.");
    log(`привязан чат ${chatId} (${row.kind})`);
    return;
  }

  if (text === "/stop") {
    q.unlink.run(chatId);
    await sendMessage(chatId, "Отключил. Чтобы вернуть напоминания, нажмите «Подключить Telegram» в Slate.");
    return;
  }

  if (text === "/help" || text === "/start@" + botName) {
    await sendMessage(chatId, "Я присылаю напоминания о занятиях.\n/stop — отключить напоминания.");
    return;
  }

  /* Ответы в боте пока не пересылаем в переписку: у преподавателя один чат
     на всех учеников, и без выбора адресата ответ ушёл бы не туда. */
  if (q.byChat.get(chatId)) {
    await sendMessage(chatId, "Ответить можно в самой программе Slate — там переписка привязана к ученику.");
  }
}

/* ------------------------------------------------------------------ запуск --- */

function start(ctx) {
  if (!enabled()) {
    ctx.log("бот не настроен (нет SLATE_BOT_TOKEN) — напоминания выключены");
    return { stop() {} };
  }
  let alive = true;
  let offset = Number((ctx.q.getState.get("offset") || {}).value || 0);

  (async () => {
    try {
      const me = await call("getMe", {});
      ctx.botName = me.username;
      ctx.log(`бот @${me.username} на связи`);
    } catch (e) {
      ctx.log(`бот не отвечает: ${e.message}`);
    }
    while (alive) {
      try {
        const updates = await call("getUpdates", { offset, timeout: 25, allowed_updates: ["message"] });
        for (const u of updates) {
          offset = u.update_id + 1;
          ctx.q.setState.run("offset", String(offset));
          try { await handleUpdate(ctx, u); } catch (e) { ctx.log(`не обработал: ${e.message}`); }
        }
      } catch (e) {
        if (alive) { ctx.log(`опрос: ${e.message}`); await new Promise((r) => setTimeout(r, 5000)); }
      }
    }
  })();

  const timer = setInterval(() => {
    tick(ctx).catch((e) => ctx.log(`рассылка: ${e.message}`));
  }, 60000);
  timer.unref && timer.unref();
  tick(ctx).catch(() => {});

  return { stop() { alive = false; clearInterval(timer); } };
}

module.exports = { schema, makeQueries, start, tick, handleUpdate, makeCode, notifyMessage, enabled, sendMessage, TOKEN };
