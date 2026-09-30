/* =============================================================================
   Календарь занятий в формате iCalendar — чтобы подписаться на него
   в «Календаре» на маке, айфоне или в Google Calendar.

   Подписка односторонняя: занятия из Slate видны в календаре и обновляются
   сами, а правки в календаре обратно не возвращаются. Для одного часового
   пояса этого достаточно, и это единственный способ, не требующий от
   человека паролей и разрешений.

   Время пишем «плавающее», без часового пояса: календарь показывает его
   как местное. Для преподавателя, который живёт там же, где ведёт занятия,
   это правильно и избавляет от возни с VTIMEZONE.
   ========================================================================== */

const PAST_DAYS = 60;      /* сколько прошедших занятий показывать */
const AHEAD_DAYS = 240;    /* и насколько вперёд */

const pad = (n) => String(n).padStart(2, "0");

/* Экранирование по правилам формата: запятые, точки с запятой и переводы строк */
function esc(text) {
  return String(text == null ? "" : text)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/* Строки длиннее 75 байт складываются с переносом и пробелом в начале */
function fold(line) {
  const out = [];
  let buf = Buffer.from(line, "utf8");
  if (buf.length <= 75) return line;
  let first = true;
  while (buf.length) {
    const take = first ? 75 : 74;
    /* режем по границе символа, чтобы не разорвать кириллицу пополам */
    let cut = Math.min(take, buf.length);
    while (cut > 1 && (buf[cut] & 0xc0) === 0x80) cut--;
    out.push((first ? "" : " ") + buf.slice(0, cut).toString("utf8"));
    buf = buf.slice(cut);
    first = false;
  }
  return out.join("\r\n");
}

const stampUTC = (ms) => {
  const d = new Date(ms);
  return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "T" +
         pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z";
};

/* «2026-10-05» + «17:00» + 90 минут → начало и конец в местном времени */
function localRange(date, time, minutes) {
  const [y, m, d] = String(date).split("-").map(Number);
  const [hh, mm] = String(time || "00:00").split(":").map(Number);
  const start = new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0);
  const end = new Date(start.getTime() + (Number(minutes) || 60) * 60000);
  const fmt = (x) => x.getFullYear() + pad(x.getMonth() + 1) + pad(x.getDate()) + "T" +
                     pad(x.getHours()) + pad(x.getMinutes()) + "00";
  return { start: fmt(start), end: fmt(end) };
}

const STATUS_WORD = {
  done: "проведено",
  no_show: "пропущено",
  moved_teacher: "перенесено учителем",
  moved_student: "перенесено учеником",
  moved: "перенесено",
};

/* Занятия преподавателя → текст календаря. */
function calendar(doc, opts) {
  const o = opts || {};
  const name = o.name || "Slate — занятия";
  const students = {};
  (doc.students || []).forEach((s) => { students[s.id] = s; });

  const today = new Date();
  const from = new Date(today.getTime() - PAST_DAYS * 86400000);
  const to = new Date(today.getTime() + AHEAD_DAYS * 86400000);
  const iso = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const lo = iso(from), hi = iso(to);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Slate//Календарь занятий//RU",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:" + esc(name),
    "X-WR-TIMEZONE:" + (o.tz || "local"),
    /* подсказки, как часто перечитывать: календари их уважают */
    "X-PUBLISHED-TTL:PT15M",
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
  ];

  const stamp = stampUTC(Date.now());
  let count = 0;

  for (const l of doc.lessons || []) {
    if (!l.date || l.date < lo || l.date > hi) continue;
    /* отменённое и перенесённое старое занятие в календаре не нужно */
    if (l.status === "cancelled" || String(l.status || "").indexOf("moved") === 0) continue;

    const s = students[l.studentId] || {};
    if (s.archived) continue;
    const range = localRange(l.date, l.time, l.dur);
    const mark = STATUS_WORD[l.status] ? " · " + STATUS_WORD[l.status] : "";
    const title = (s.name || "Занятие") + (s.subject ? " · " + s.subject : "") + mark;
    const body = [
      s.level ? "Уровень: " + s.level : "",
      l.hw ? "Домашнее задание: " + l.hw : "",
      l.note ? "Заметка: " + l.note : "",
      l.online ? "Онлайн-занятие" : "",
    ].filter(Boolean).join("\n");

    lines.push(
      "BEGIN:VEVENT",
      "UID:" + esc(l.id) + "@slate",
      "DTSTAMP:" + stamp,
      "DTSTART:" + range.start,
      "DTEND:" + range.end,
      "SUMMARY:" + esc(title),
    );
    if (body) lines.push("DESCRIPTION:" + esc(body));
    if (l.link) lines.push("URL:" + esc(l.link), "LOCATION:" + esc(l.link));
    else if (!l.online && s.place) lines.push("LOCATION:" + esc(s.place));
    if (l.status === "done") lines.push("STATUS:CONFIRMED");
    lines.push("END:VEVENT");
    count++;
  }

  lines.push("END:VCALENDAR");
  return { text: lines.map(fold).join("\r\n") + "\r\n", count };
}

module.exports = { calendar, esc, fold, localRange, PAST_DAYS, AHEAD_DAYS };

/* -------------------------------------------------------------- чтение --- */
/* Разбор чужого календаря: нам нужны только время и название события.
   Полный формат поддерживать незачем — берём то, что шлют Apple и Google. */
function unfold(text) {
  return String(text).replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
}
function unesc(v) {
  return String(v).replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\;/g, ";").replace(/\\\\/g, "\\");
}
/* «20261005T170000Z» или «20261005» → отметка времени и признак «весь день» */
function parseStamp(value, params) {
  const v = String(value || "").trim();
  const allDay = /^\d{8}$/.test(v) || /VALUE=DATE/i.test(params || "");
  const y = +v.slice(0, 4), mo = +v.slice(4, 6) - 1, d = +v.slice(6, 8);
  if (allDay) return { ms: new Date(y, mo, d).getTime(), allDay: true };
  const hh = +v.slice(9, 11) || 0, mi = +v.slice(11, 13) || 0, ss = +v.slice(13, 15) || 0;
  /* время с Z — всемирное; без Z считаем местным, как это делают календари */
  const ms = /Z$/.test(v) ? Date.UTC(y, mo, d, hh, mi, ss) : new Date(y, mo, d, hh, mi, ss).getTime();
  return { ms, allDay: false };
}

function parse(text, opts) {
  const o = opts || {};
  const limitPast = Date.now() - (o.pastDays || 14) * 86400000;
  const limitAhead = Date.now() + (o.aheadDays || 120) * 86400000;
  const out = [];
  let name = "";
  let cur = null;

  for (const raw of unfold(text).split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") {
      if (cur && cur.start && out.length < 500 &&
          cur.start >= limitPast && cur.start <= limitAhead) {
        out.push({
          id: cur.uid || String(cur.start),
          title: cur.title || "Занято",
          start: cur.start, end: cur.end || cur.start + 3600000,
          allDay: !!cur.allDay,
        });
      }
      cur = null; continue;
    }
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const left = line.slice(0, colon), value = line.slice(colon + 1);
    const semi = left.indexOf(";");
    const key = (semi < 0 ? left : left.slice(0, semi)).toUpperCase();
    const params = semi < 0 ? "" : left.slice(semi + 1);

    if (!cur) {
      if (key === "X-WR-CALNAME") name = unesc(value);
      continue;
    }
    if (key === "UID") cur.uid = value;
    else if (key === "SUMMARY") cur.title = unesc(value);
    else if (key === "DTSTART") { const p = parseStamp(value, params); cur.start = p.ms; cur.allDay = p.allDay; }
    else if (key === "DTEND") cur.end = parseStamp(value, params).ms;
  }
  out.sort((a, b) => a.start - b.start);
  return { name, events: out };
}

module.exports.parse = parse;
module.exports.unfold = unfold;
