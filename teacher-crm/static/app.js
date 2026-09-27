/* CRM преподавателя английского — интерфейс.
   Один файл, без фреймворков: небольшие функции, которые собирают HTML
   и перерисовывают активный раздел целиком. */

/* ------------------------------------------------------------- основа --- */
const API = {
  async req(method, url, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(url, opts);
    let data = null;
    try { data = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error((data && (data.detail || data.error)) || "Ошибка запроса");
    return data;
  },
  get:  (u) => API.req("GET", u),
  post: (u, b) => API.req("POST", u, b),
  put:  (u, b) => API.req("PUT", u, b),
  del:  (u) => API.req("DELETE", u),
};

const state = {
  tab: "dashboard",
  settings: { currency: "֏", default_duration: "60", default_price: "0", teacher_name: "", no_show_counts: "1" },
  students: [],
  calMode: "week",
  anchor: "",            // любая дата внутри показываемой недели или месяца
  studentQuery: "",
  materialQuery: "",
  showArchived: false,
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------------------------------------------------------------- даты --- */
const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const todayISO = () => iso(new Date());
const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return iso(d); };
const addMonths = (s, n) => { const d = parseDate(s); d.setMonth(d.getMonth() + n, 1); return iso(d); };
const weekStart = (s) => { const d = parseDate(s); return addDays(s, -((d.getDay() + 6) % 7)); };
const monthStart = (s) => { const d = parseDate(s); return iso(new Date(d.getFullYear(), d.getMonth(), 1)); };
const monthEnd = (s) => { const d = parseDate(s); return iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)); };

function fmtDate(s) {
  if (!s) return "—";
  try { return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(parseDate(s)); }
  catch (e) { return s; }
}
function fmtDateShort(s) {
  if (!s) return "—";
  const d = parseDate(s);
  return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function fmtMonthTitle(s) {
  try { return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(parseDate(s)); }
  catch (e) { return s; }
}
function money(n) {
  return (Math.round((+n || 0) * 100) / 100).toLocaleString("ru-RU") + " " + state.settings.currency;
}
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
const lessonsWord = (n) => plural(n, "занятие", "занятия", "занятий");
const studentsWord = (n) => plural(n, "ученик", "ученика", "учеников");

/* ------------------------------------------------------- модалка и тост --- */
let submitHandler = null;

function modal(title, body, footer, wide) {
  const m = $("modal");
  m.className = "modal" + (wide ? " wide" : "");
  m.innerHTML =
    `<div class="modal-h"><h3>${esc(title)}</h3><button class="x" data-act="close">×</button></div>` +
    `<div class="modal-b">${body}</div>` +
    `<div class="modal-f">${footer || '<button class="btn" data-act="close">Закрыть</button>'}</div>`;
  $("overlay").classList.add("on");
}
function closeModal() { $("overlay").classList.remove("on"); submitHandler = null; }
function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("on");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("on"), 2200);
}
const val = (id) => { const el = $(id); return el ? el.value.trim() : ""; };
const num = (id) => { const v = val(id); return v === "" ? null : Number(v); };
const checked = (id) => { const el = $(id); return !!(el && el.checked); };

/* --------------------------------------------------------------- меню --- */
const TABS = [
  { key: "dashboard", title: "Сводка" },
  { key: "students",  title: "Ученики" },
  { key: "calendar",  title: "Календарь" },
  { key: "payments",  title: "Оплаты" },
  { key: "materials", title: "Материалы" },
  { key: "settings",  title: "Настройки" },
];

function renderMenu() {
  $("menu").innerHTML = TABS.map((t) => {
    let cnt = "";
    if (t.key === "students" && state.students.length) cnt = `<span class="cnt">${state.students.length}</span>`;
    return `<button data-tab="${t.key}" class="${state.tab === t.key ? "on" : ""}">
      <span>${esc(t.title)}</span>${cnt}</button>`;
  }).join("");
  $("sideNote").textContent = "Данные хранятся на этом компьютере";
}

function head(title, sub, actions) {
  return `<div class="top"><div><h1>${esc(title)}</h1>` +
    (sub ? `<div class="sub">${esc(sub)}</div>` : "") + `</div>` +
    `<div class="top-act">${actions || ""}</div></div>`;
}

/* ------------------------------------------------------------- ученики --- */
async function loadStudents() {
  state.students = await API.get(
    `/api/students?archived=${state.showArchived ? 1 : 0}&q=${encodeURIComponent(state.studentQuery)}`);
}

function studentRow(s) {
  const left = s.lessons_left || 0;
  const balanceTag = s.debt > 0
    ? `<span class="tag bad">долг ${money(s.debt)}</span>`
    : `<span class="tag ok">оплачено</span>`;
  const leftTag = left > 0
    ? `<span class="tag ${left <= 2 ? "warn" : "mut"}">${left} ${lessonsWord(left)}</span>`
    : `<span class="tag mut">нет абонемента</span>`;
  const next = s.next_lesson ? `${fmtDate(s.next_lesson.date)}, ${s.next_lesson.time}` : "занятий не назначено";
  return `<div class="row clickable" data-open-student="${s.id}">
    <div class="g"><div class="nm">${esc(s.name)}</div>
      <div class="sb">${esc([s.level, s.schedule].filter(Boolean).join(" · ") || "—")} · ${esc(next)}</div></div>
    ${leftTag}${balanceTag}
    <div class="act"><button class="btn btn-s" data-act="portal-share" data-id="${s.id}">Кабинет</button></div>
  </div>`;
}

async function viewStudents() {
  await loadStudents();
  const body = state.students.length
    ? state.students.map(studentRow).join("")
    : `<div class="empty"><b>Учеников пока нет</b>Добавьте первого — это полминуты.</div>`;

  return head("Ученики", `${state.students.length} ${studentsWord(state.students.length)} в списке`,
    `<input class="inp search" id="stSearch" placeholder="Поиск по имени, уровню, целям" value="${esc(state.studentQuery)}">
     <button class="btn" data-act="toggle-archived">${state.showArchived ? "Активные" : "Архив"}</button>
     <button class="btn btn-p" data-act="student-new">Новый ученик</button>`) +
    `<div class="card"><div class="card-b">${body}</div></div>`;
}

function studentForm(s) {
  const d = s || {};
  modal(s ? "Изменить ученика" : "Новый ученик",
    `<div class="f">
      <label class="fl">Имя<input class="inp" id="st-name" value="${esc(d.name || "")}" placeholder="Анна Петросян"></label>
      <div class="f-row">
        <label class="fl">Контакт<input class="inp" id="st-contact" value="${esc(d.contact || "")}" placeholder="+374 … / @telegram"></label>
        <label class="fl">Уровень<input class="inp" id="st-level" value="${esc(d.level || "")}" placeholder="B1, Intermediate"></label>
      </div>
      <label class="fl">Регулярное расписание<input class="inp" id="st-schedule" value="${esc(d.schedule || "")}" placeholder="Пн и Чт, 18:00"></label>
      <label class="fl">Цели и особые задачи (IEP)<textarea class="inp" id="st-goals" placeholder="Подготовка к IELTS, speaking, дислексия — больше устных заданий">${esc(d.goals || "")}</textarea></label>
      <label class="fl">Заметки<textarea class="inp" id="st-notes">${esc(d.notes || "")}</textarea></label>
      ${s ? `<label class="check"><input type="checkbox" id="st-archived" ${d.archived ? "checked" : ""}>В архиве</label>` : ""}
    </div>`,
    (s ? `<button class="btn btn-d" data-act="student-delete" data-id="${d.id}">Удалить</button>` : "") +
    `<button class="btn" data-act="close">Отмена</button>
     <button class="btn btn-p" data-act="submit">Сохранить</button>`);

  submitHandler = async () => {
    const payload = {
      name: val("st-name"), contact: val("st-contact"), level: val("st-level"),
      schedule: val("st-schedule"), goals: val("st-goals"), notes: val("st-notes"),
      archived: s ? checked("st-archived") : false,
    };
    if (!payload.name) { $("st-name").focus(); return; }
    if (s) await API.put(`/api/students/${d.id}`, payload);
    else await API.post("/api/students", payload);
    closeModal();
    await render();
    toast("Сохранено");
  };
}

const fileIcon = (mime) => /^image\//.test(mime || "") ? "🖼"
  : mime === "application/pdf" ? "📄"
  : /^audio\//.test(mime || "") ? "🎧"
  : /^video\//.test(mime || "") ? "🎬" : "📎";

function fmtWhen(ts) {
  try { return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(ts)); }
  catch (e) { return ""; }
}

function openViewer(url, title, mime) {
  modal(title,
    /^image\//.test(mime || "")
      ? `<img src="${esc(url)}" alt="" style="max-width:100%;border-radius:12px;display:block;margin:0 auto">`
      : mime === "application/pdf"
        ? `<iframe src="${esc(url)}" style="width:100%;height:min(70vh,680px);border:1px solid var(--line);border-radius:12px;background:#fff"></iframe>`
        : `<div class="empty"><b>${esc(title)}</b>Файл откроется в новой вкладке</div>`,
    `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener">Открыть отдельно</a>
     <a class="btn btn-p" href="${esc(url)}" download="${esc(title)}">Скачать</a>`, true);
}

async function portalShare(id) {
  const info = await API.get(`/api/students/${id}/portal`);
  const url = location.origin + info.path;
  modal("Кабинет ученика · " + info.name,
    `<div class="f">
      <label class="fl">Ссылка для ученика<input class="inp" id="pl-url" value="${esc(url)}" readonly></label>
      <label class="fl">Код входа<input class="inp tnum" id="pl-code" value="${esc(info.code)}" readonly
        style="font-size:22px;letter-spacing:.18em"></label>
      <textarea class="inp" id="pl-text" style="min-height:80px">Кабинет: ${esc(url)}\nКод: ${esc(info.code)}</textarea>
      <p class="hint">Ученик открывает ссылку, вводит код один раз и дальше видит остаток занятий,
      расписание, домашние задания, материалы и переписку с вами.</p>
    </div>`,
    `<button class="btn btn-d" data-act="portal-reset" data-id="${id}">Сменить код</button>
     <button class="btn" data-act="close">Закрыть</button>
     <button class="btn" data-act="copy-portal">Скопировать</button>
     <a class="btn btn-p" href="${esc(url)}" target="_blank" rel="noopener">Открыть кабинет</a>`);
}

async function openStudent(id) {
  const s = await API.get(`/api/students/${id}`);
  const msgs = await API.get(`/api/students/${id}/messages`);
  const photo = (s.materials || []).find((m) => m.kind === "photo");
  const left = s.lessons_left || 0;
  const m = s.money;

  const lessonsList = s.lessons.length
    ? s.lessons.slice(0, 12).map((l) => `<div class="row clickable" data-open-lesson="${l.id}">
        <div class="g"><div class="nm">${esc(fmtDate(l.date))}, ${esc(l.time)}</div>
          <div class="sb">${esc(l.topic || "без темы")}${l.homework ? " · д/з: " + esc(l.homework) : ""}</div></div>
        ${statusTag(l.status)}</div>`).join("")
    : `<div class="empty">Занятий пока нет</div>`;

  modal(s.name,
    `<div class="stack">
      ${photo ? `<div style="display:flex;justify-content:center">
        <img src="/api/materials/${photo.id}/file" alt=""
             style="width:96px;height:96px;border-radius:50%;object-fit:cover;border:2px solid var(--olive-200)"></div>` : ""}
      <div class="grid-3">
        <div class="kpi ${left <= 0 ? "" : left <= 2 ? "warn" : "good"}">
          <div class="l">Осталось занятий</div><div class="v tnum">${left}</div>
          <div class="n">${s.active_package ? "до " + fmtDate(s.active_package.expires_on) : "нет активного абонемента"}</div></div>
        <div class="kpi ${m.debt > 0 ? "bad" : "good"}">
          <div class="l">Задолженность</div><div class="v tnum">${m.debt > 0 ? money(m.debt) : "нет"}</div>
          <div class="n">начислено ${money(m.charged)} · оплачено ${money(m.paid)}</div></div>
        <div class="kpi"><div class="l">Занятий проведено</div>
          <div class="v tnum">${s.lessons.filter((l) => l.status === "done").length}</div>
          <div class="n">всего в журнале ${s.lessons.length}</div></div>
      </div>

      <div class="card"><div class="card-b" style="padding-top:10px">
        <div class="row"><div class="g"><div class="nm">${esc([s.level, s.schedule].filter(Boolean).join(" · ") || "—")}</div>
          <div class="sb">${esc(s.contact || "контакт не указан")}</div></div></div>
        ${s.goals ? `<div class="row"><div class="g"><div class="sb" style="white-space:normal">Цели: ${esc(s.goals)}</div></div></div>` : ""}
        ${s.notes ? `<div class="row"><div class="g"><div class="sb" style="white-space:normal">${esc(s.notes)}</div></div></div>` : ""}
      </div></div>

      <div class="card"><div class="card-h"><h2>Абонементы</h2>
        <button class="btn btn-s" data-act="package-new" data-student="${s.id}">Купить абонемент</button></div>
        <div class="card-b">${s.packages.length ? s.packages.map(packageRow).join("") : `<div class="empty">Абонементов пока нет</div>`}</div></div>

      <div class="card"><div class="card-h"><h2>Материалы</h2>
        <span><button class="btn btn-s" data-act="material-link" data-student="${s.id}">Ссылка</button>
        <button class="btn btn-s" data-act="material-upload" data-student="${s.id}">Файл</button></span></div>
        <div class="card-b">${s.materials.length ? s.materials.map((m) => `<div class="row">
          <div class="g"><div class="nm">${m.kind === "file" ? "📄" : "🔗"} ${esc(m.title)}</div>
            <div class="sb">${esc(m.note || "")}</div></div>
          <a class="btn btn-s" href="${m.kind === "file" ? "/api/materials/" + m.id + "/file" : esc(m.url)}" target="_blank" rel="noopener">Открыть</a>
        </div>`).join("") : `<div class="empty">Материалов пока нет</div>`}</div></div>

      <div class="card"><div class="card-h"><h2>Переписка с учеником</h2>
        <button class="btn btn-s" data-act="portal-share" data-id="${s.id}">Кабинет ученика</button></div>
        <div class="card-b">
          <div class="chat">${msgs.length ? msgs.map((m) => `<div class="msg ${m.author === "teacher" ? "me" : ""}">
            ${m.text ? `<div class="tx">${esc(m.text)}</div>` : ""}
            ${m.file ? `<button class="msg-file" data-view="${esc(m.file.open_url)}" data-title="${esc(m.file.title)}" data-mime="${esc(m.file.mime || "")}">${fileIcon(m.file.mime)} ${esc(m.file.title)}</button>` : ""}
            <div class="wh">${m.author === "teacher" ? "Вы" : esc(s.name)} · ${esc(fmtWhen(m.created))}</div>
          </div>`).join("") : `<div class="empty">Сообщений пока нет</div>`}</div>
          <div class="chat-send">
            <input class="inp" id="ch-text" placeholder="Написать ученику">
            <button class="btn" data-act="chat-file" data-id="${s.id}">📎</button>
            <button class="btn btn-p" data-act="chat-send" data-id="${s.id}">Отправить</button>
          </div>
        </div></div>

      <div class="card"><div class="card-h"><h2>Оплаты</h2>
        <button class="btn btn-s" data-act="payment-new" data-student="${s.id}">Записать оплату</button></div>
        <div class="card-b">${s.payments.length ? s.payments.slice(0, 8).map((p) => `<div class="row clickable" data-open-payment="${p.id}">
          <div class="g"><div class="nm">${money(p.amount)}</div>
            <div class="sb">${esc(fmtDate(p.paid_on))}${p.method ? " · " + esc(p.method) : ""}${p.note ? " · " + esc(p.note) : ""}</div></div>
          ${p.status === "paid" ? '<span class="tag ok">оплачено</span>' : '<span class="tag warn">ожидается</span>'}
        </div>`).join("") : `<div class="empty">Оплат пока нет</div>`}</div></div>

      <div class="card"><div class="card-h"><h2>Журнал занятий</h2>
        <button class="btn btn-s btn-p" data-act="lesson-new" data-student="${s.id}">Добавить занятие</button></div>
        <div class="card-b">${lessonsList}</div></div>
    </div>`,
    `<button class="btn" data-act="student-edit" data-id="${s.id}">Изменить</button>
     <button class="btn" data-act="close">Закрыть</button>`, true);
}

/* ---------------------------------------------------------- абонементы --- */
function packStatusTag(p) {
  if (p.status === "finished") return '<span class="tag mut">закончился</span>';
  if (p.status === "expired") return '<span class="tag bad">просрочен</span>';
  if (p.left <= 2 || (p.days_left !== null && p.days_left <= 7)) return '<span class="tag warn">на исходе</span>';
  return '<span class="tag ok">активен</span>';
}

function packageRow(p) {
  const days = String(p.weekdays || "").split(",").filter(Boolean)
    .map((n) => WEEKDAYS[Number(n) - 1] && WEEKDAYS[Number(n) - 1].s.toLowerCase()).filter(Boolean);
  const period = p.expires_on
    ? `${fmtDate(p.purchased_on)} — ${fmtDate(p.expires_on)}${days.length ? " · " + days.join(", ") : ""}`
    : `с ${fmtDate(p.purchased_on)}, без срока`;
  return `<div class="row">
    <div class="g"><div class="nm">${p.lessons_total} ${lessonsWord(p.lessons_total)} · ${money(p.price)}</div>
      <div class="sb">${esc(period)} · осталось ${p.left} из ${p.lessons_total}${p.note ? " · " + esc(p.note) : ""}</div></div>
    ${packStatusTag(p)}
    <div class="act"><button class="btn btn-s btn-d" data-act="package-delete" data-id="${p.id}" data-student="${p.student_id}">Удалить</button></div>
  </div>`;
}

const WEEKDAYS = [
  { n: 1, s: "Пн" }, { n: 2, s: "Вт" }, { n: 3, s: "Ср" }, { n: 4, s: "Чт" },
  { n: 5, s: "Пт" }, { n: 6, s: "Сб" }, { n: 7, s: "Вс" },
];

/* Даты занятий абонемента: столько же, сколько занятий, по выбранным дням.
   Считаем и здесь, чтобы последний день был виден сразу, без сохранения. */
function packDates(start, days, count) {
  const out = [];
  if (!start || !days.length || count <= 0) return out;
  const d = new Date(start + "T00:00:00");
  for (let guard = 0; out.length < count && guard < 4000; guard++) {
    const wd = d.getDay() === 0 ? 7 : d.getDay();
    if (days.includes(wd)) out.push(isoOf(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}
function isoOf(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function packageForm(studentId, pack) {
  const p = pack || {};
  const today = todayISO();
  const chosen = String(p.weekdays || "").split(",").filter(Boolean).map(Number);

  modal(pack ? "Изменить абонемент" : "Новый абонемент",
    `<div class="f">
      <div class="f-row">
        <label class="fl">Занятий в абонементе
          <input class="inp tnum" id="pk-total" type="number" min="1" max="200" value="${p.lessons_total || 8}"></label>
        <label class="fl">Начинать с<input class="inp" id="pk-from" type="date" value="${esc(p.purchased_on || today)}"></label>
      </div>
      <div class="quick" id="pk-quick">
        ${[4, 8, 10, 12, 16, 20].map((n) => `<button type="button" class="chip-btn" data-total="${n}">${n}</button>`).join("")}
        <span class="hint">или впишите своё число</span>
      </div>
      <div class="fl">Дни недели
        <div class="days" id="pk-days">
          ${WEEKDAYS.map((d) => `<button type="button" class="day-btn${chosen.includes(d.n) ? " on" : ""}" data-day="${d.n}">${d.s}</button>`).join("")}
        </div>
      </div>
      <div class="f-row">
        <label class="fl">Время занятий<input class="inp" id="pk-time" type="time" value="${esc(p.lesson_time || "17:00")}"></label>
        <label class="fl">Стоимость<input class="inp tnum" id="pk-price" type="number" min="0" step="100" value="${p.price != null ? p.price : ""}"></label>
      </div>
      <div class="calc" id="pk-calc"></div>
      <label class="fl">Заметка<input class="inp" id="pk-note" value="${esc(p.note || "")}"></label>
      ${pack ? `<p class="hint">Уже созданные занятия останутся как есть — поменяются число занятий, дни и последний день.</p>`
             : `<label class="check"><input type="checkbox" id="pk-lessons" checked>Сразу поставить занятия в расписание</label>
                <label class="check"><input type="checkbox" id="pk-paid" checked>Сразу записать оплату на всю сумму</label>`}
    </div>`,
    `<button class="btn" data-act="close">Отмена</button>
     <button class="btn btn-p" data-act="submit">Сохранить</button>`);

  const days = new Set(chosen);
  const calc = document.getElementById("pk-calc");

  function recalc() {
    const total = Number(val("pk-total")) || 0;
    const list = packDates(val("pk-from"), [...days].sort(), total);
    if (!days.size) {
      calc.innerHTML = `<b>Выберите дни недели</b><span>по ним посчитается последний день абонемента</span>`;
      calc.className = "calc empty-calc";
      return;
    }
    calc.className = "calc";
    calc.innerHTML =
      `<b>Последнее занятие: ${list.length ? fmtDate(list[list.length - 1]) : "—"}</b>` +
      `<span>${total} ${lessonsWord(total)} по ${[...days].sort().map((n) => WEEKDAYS[n - 1].s.toLowerCase()).join(", ")}` +
      `${val("pk-time") ? " в " + val("pk-time") : ""} · первое ${list.length ? fmtDate(list[0]) : "—"}</span>` +
      (list.length > 1 ? `<span class="dates">${list.slice(0, 12).map(fmtDate).join(" · ")}${list.length > 12 ? " …" : ""}</span>` : "");
  }

  document.getElementById("pk-days").onclick = (e) => {
    const b = e.target.closest("[data-day]");
    if (!b) return;
    const n = Number(b.dataset.day);
    days.has(n) ? days.delete(n) : days.add(n);
    b.classList.toggle("on", days.has(n));
    recalc();
  };
  document.getElementById("pk-quick").onclick = (e) => {
    const b = e.target.closest("[data-total]");
    if (!b) return;
    document.getElementById("pk-total").value = b.dataset.total;
    recalc();
  };
  ["pk-total", "pk-from", "pk-time"].forEach((id) => {
    document.getElementById(id).addEventListener("input", recalc);
  });
  recalc();

  submitHandler = async () => {
    const total = Number(val("pk-total")) || 0;
    if (total <= 0) { toast("Укажите число занятий"); return; }
    const payload = {
      student_id: Number(studentId),
      lessons_total: total,
      purchased_on: val("pk-from"),
      expires_on: null,
      price: Number(val("pk-price")) || 0,
      note: val("pk-note"),
      weekdays: [...days].sort(),
      lesson_time: val("pk-time"),
      create_lessons: pack ? false : checked("pk-lessons"),
      pay_now: pack ? false : checked("pk-paid"),
    };
    const res = pack
      ? await API.put(`/api/packages/${p.id}`, payload)
      : await API.post("/api/packages", payload);
    closeModal();
    await openStudent(studentId);
    toast(res && res.lessons_created
      ? `Абонемент создан, занятий в расписании: ${res.lessons_created}`
      : "Абонемент сохранён");
  };
}

/* ------------------------------------------------------------ календарь --- */
/* Статусы занятия. Перенос различаем по тому, кто его затеял. */
const STATUS_TEXT = {
  planned:       "запланировано",
  done:          "проведено",
  moved_teacher: "перенесено учителем",
  moved_student: "перенесено учеником",
  no_show:       "пропущено",
  cancelled:     "отменено",
  moved:         "перенесено",
};
const STATUS_SHORT = {
  planned:       "план",
  done:          "проведено",
  moved_teacher: "перенос (учитель)",
  moved_student: "перенос (ученик)",
  no_show:       "пропущено",
  cancelled:     "отменено",
  moved:         "перенос",
};
const STATUS_TONE = {
  planned: "mut", done: "ok", moved_teacher: "warn", moved_student: "warn",
  no_show: "bad", cancelled: "bad", moved: "warn",
};

function statusTag(status) {
  if (!STATUS_TEXT[status]) return "";
  return `<span class="tag ${STATUS_TONE[status] || "mut"}">${STATUS_TEXT[status]}</span>`;
}

function lessonCard(l) {
  const tip = `${l.time} · ${l.student_name} · ${STATUS_TEXT[l.status] || ""}${l.topic ? " · " + l.topic : ""}`;
  return `<div class="lsn ${l.status}" data-open-lesson="${l.id}" title="${esc(tip)}">
    <div class="t tnum">${esc(l.time)}</div>
    <div class="n">${esc(l.student_name)}</div>
    <div class="s">${esc(l.status === "planned" ? (l.topic || "") : (STATUS_SHORT[l.status] || ""))}</div></div>`;
}
function statusText(s) { return STATUS_TEXT[s] || ""; }

async function viewCalendar() {
  if (!state.anchor) state.anchor = todayISO();
  const isMonth = state.calMode === "month";
  const from = isMonth ? weekStart(monthStart(state.anchor)) : weekStart(state.anchor);
  const to = isMonth ? addDays(weekStart(monthStart(state.anchor)), 41) : addDays(from, 6);
  const [lessons, waiting] = await Promise.all([
    API.get(`/api/lessons?start=${from}&end=${to}`),
    API.get("/api/lessons/unmarked"),
  ]);
  const byDay = {};
  lessons.forEach((l) => { (byDay[l.date] = byDay[l.date] || []).push(l); });

  const title = isMonth
    ? fmtMonthTitle(state.anchor)
    : `${fmtDate(weekStart(state.anchor))} — ${fmtDate(addDays(weekStart(state.anchor), 6))}`;

  const bar = `<div class="cal-bar">
    <span class="cal-title">${esc(title)}</span>
    <span class="segm">
      <button class="${!isMonth ? "on" : ""}" data-act="cal-mode" data-mode="week">Неделя</button>
      <button class="${isMonth ? "on" : ""}" data-act="cal-mode" data-mode="month">Месяц</button>
    </span>
    ${waiting.length ? `<button class="btn btn-s" data-act="unmarked">Не отмечено: ${waiting.length}</button>` : ""}
  </div>`;

  let grid;
  if (isMonth) {
    const start = weekStart(monthStart(state.anchor));
    const thisMonth = parseDate(state.anchor).getMonth();
    let cells = "";
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i);
      const dt = parseDate(d);
      if (i >= 35 && dt.getMonth() !== thisMonth) break;
      const list = byDay[d] || [];
      cells += `<div class="mc ${d === todayISO() ? "today" : ""} ${dt.getMonth() !== thisMonth ? "out" : ""}">
        <div class="mc-h"><button class="mc-d" data-act="goto-week" data-date="${d}">${dt.getDate()}</button>
          <button class="mc-add" data-act="lesson-new" data-date="${d}">+</button></div>
        ${list.slice(0, 3).map(lessonCard).join("")}
        ${list.length > 3 ? `<button class="mc-more" data-act="goto-week" data-date="${d}">ещё ${list.length - 3}</button>` : ""}
      </div>`;
    }
    grid = `<div class="month"><div class="mhead">${DAYS.map((d) => `<div class="mh">${d}</div>`).join("")}</div>
      <div class="mgrid">${cells}</div></div>`;
  } else {
    let days = "";
    for (let i = 0; i < 7; i++) {
      const d = addDays(from, i);
      const list = byDay[d] || [];
      days += `<div class="day ${d === todayISO() ? "today" : ""}">
        <div class="day-h"><span class="dn">${DAYS[i]}</span><span class="dd">${fmtDateShort(d)}</span></div>
        <div class="day-b">${list.map(lessonCard).join("")}
          <button class="day-add" data-act="lesson-new" data-date="${d}">+</button></div></div>`;
    }
    grid = `<div class="week">${days}</div>`;
  }

  return head("Календарь", "Клик по занятию открывает карточку",
    `<button class="btn" data-act="cal-prev">←</button>
     <button class="btn" data-act="cal-today">Сегодня</button>
     <button class="btn" data-act="cal-next">→</button>
     <button class="btn btn-p" data-act="lesson-new" data-date="${todayISO()}">Новое занятие</button>`) + bar + grid;
}

/* --------------------------------------------------------------- занятие --- */
function studentOptions(selected) {
  return state.students.map((s) =>
    `<option value="${s.id}" ${String(s.id) === String(selected) ? "selected" : ""}>${esc(s.name)}</option>`).join("");
}

async function lessonForm(lesson, presetDate, presetStudent) {
  if (!state.students.length) await loadStudents();
  if (!state.students.length) { studentForm(null); return; }
  const l = lesson || {};
  const isNew = !lesson;

  modal(isNew ? "Новое занятие" : "Занятие",
    `<div class="f">
      <label class="fl">Ученик<select class="inp" id="ls-student">${studentOptions(l.student_id || presetStudent || state.students[0].id)}</select></label>
      <div class="f-row-3">
        <label class="fl">Дата<input class="inp" id="ls-date" type="date" value="${esc(l.date || presetDate || todayISO())}"></label>
        <label class="fl">Время<input class="inp" id="ls-time" type="time" value="${esc(l.time || "17:00")}"></label>
        <label class="fl">Минут<input class="inp tnum" id="ls-duration" type="number" min="15" step="15" value="${l.duration || state.settings.default_duration}"></label>
      </div>
      <label class="fl">Тема<input class="inp" id="ls-topic" value="${esc(l.topic || "")}" placeholder="Present Perfect, устная практика"></label>
      <label class="fl">Материалы (заметка)<input class="inp" id="ls-materials" value="${esc(l.materials_note || "")}" placeholder="Unit 5, карточки"></label>
      <label class="fl">Домашнее задание<input class="inp" id="ls-homework" value="${esc(l.homework || "")}"></label>
      <label class="fl">Заметка после урока<textarea class="inp" id="ls-notes">${esc(l.notes || "")}</textarea></label>
      ${isNew ? `<div class="f-row">
        <label class="fl">Повторять недель<input class="inp tnum" id="ls-repeat" type="number" min="0" max="52" value="0"></label>
        <label class="fl">Цена разового занятия<input class="inp tnum" id="ls-price" type="number" min="0" step="100" value="" placeholder="если без абонемента"></label>
      </div>
      <label class="check"><input type="checkbox" id="ls-usepack" checked>Списывать из активного абонемента</label>` : ""}
      ${!isNew && l.moved_from ? `<div class="chain">Перенесено с ${esc(fmtDate(l.moved_from.date))}, ${esc(l.moved_from.time)}${l.moved_from.moved_by === "student" ? " · перенёс ученик" : l.moved_from.moved_by === "teacher" ? " · перенёс учитель" : ""}${l.move_reason ? " · причина: " + esc(l.move_reason) : ""}</div>` : ""}
      ${!isNew && l.moved_to ? `<div class="chain">Перенесено на ${esc(fmtDate(l.moved_to.date))}, ${esc(l.moved_to.time)}</div>` : ""}
    </div>`,
    (isNew ? "" :
      `<button class="btn btn-d" data-act="lesson-delete" data-id="${l.id}">Удалить</button>
       <button class="btn" data-act="lesson-move" data-id="${l.id}">Перенести</button>
       ${l.status === "planned"
         ? `<button class="btn" data-act="lesson-status" data-id="${l.id}" data-status="cancelled">Отменено</button>
            <button class="btn" data-act="lesson-status" data-id="${l.id}" data-status="no_show">Пропущено</button>
            <button class="btn btn-p" data-act="lesson-status" data-id="${l.id}" data-status="done">Проведено</button>`
         : `<button class="btn" data-act="lesson-status" data-id="${l.id}" data-status="planned">Вернуть в план</button>`}`) +
    `<button class="btn" data-act="close">Закрыть</button>
     <button class="btn btn-p" data-act="submit">Сохранить</button>`, true);

  submitHandler = async () => {
    const payload = {
      student_id: Number(val("ls-student")),
      date: val("ls-date"), time: val("ls-time"),
      duration: Number(val("ls-duration")) || 60,
      topic: val("ls-topic"), materials_note: val("ls-materials"),
      homework: val("ls-homework"), notes: val("ls-notes"),
      status: l.status || "planned",
      price: isNew ? num("ls-price") : (l.price ?? null),
      package_id: isNew ? null : (l.package_id ?? null),
      use_package: isNew ? checked("ls-usepack") : false,
      repeat_weeks: isNew ? Number(val("ls-repeat")) || 0 : 0,
    };
    if (isNew) {
      const res = await API.post("/api/lessons", payload);
      toast(res.count > 1 ? `Создано ${res.count} ${lessonsWord(res.count)}` : "Занятие создано");
    } else {
      await API.put(`/api/lessons/${l.id}`, payload);
      toast("Сохранено");
    }
    closeModal();
    await render();
  };
}

async function openLesson(id) {
  const l = await API.get(`/api/lessons/${id}`);
  await lessonForm(l);
}

function moveForm(id) {
  modal("Перенос занятия",
    `<div class="f">
      <div class="f-row">
        <label class="fl">Новая дата<input class="inp" id="mv-date" type="date" value="${todayISO()}"></label>
        <label class="fl">Новое время<input class="inp" id="mv-time" type="time" value=""></label>
      </div>
      <label class="fl">Кто переносит
        <select class="inp" id="mv-by">
          <option value="teacher">Учитель</option>
          <option value="student">Ученик</option>
        </select></label>
      <label class="fl">Причина переноса<input class="inp" id="mv-reason" placeholder="Ученик заболел"></label>
      <p class="hint">Старое занятие останется в истории — с пометкой, кто перенёс, — а новое будет на него ссылаться.</p>
    </div>`,
    `<button class="btn" data-act="close">Отмена</button>
     <button class="btn btn-p" data-act="submit">Перенести</button>`);
  submitHandler = async () => {
    await API.post(`/api/lessons/${id}/move`, {
      date: val("mv-date"), time: val("mv-time") || null, reason: val("mv-reason"), by: val("mv-by"),
    });
    closeModal();
    await render();
    toast("Занятие перенесено");
  };
}

async function unmarkedModal() {
  const list = await API.get("/api/lessons/unmarked");
  modal("Не отмеченные занятия",
    `<p class="hint" style="padding-bottom:10px">Прошедшие занятия, по которым не указано, что было.</p>
     <div class="card"><div class="card-b">` +
    (list.length ? list.map((l) => `<div class="row">
        <div class="g"><div class="nm">${esc(l.student_name)}</div>
          <div class="sb">${esc(fmtDate(l.date))}, ${esc(l.time)}${l.topic ? " · " + esc(l.topic) : ""}</div></div>
        <div class="act">
          <button class="btn btn-s btn-p" data-act="lesson-status" data-id="${l.id}" data-status="done" data-stay="1">Проведено</button>
          <button class="btn btn-s" data-act="lesson-status" data-id="${l.id}" data-status="no_show" data-stay="1">Пропущено</button>
          <button class="btn btn-s" data-act="lesson-status" data-id="${l.id}" data-status="cancelled" data-stay="1">Отменено</button>
        </div></div>`).join("") : `<div class="empty">Всё прошедшее отмечено</div>`) +
    `</div></div>`,
    `<button class="btn" data-act="close">Закрыть</button>` +
    (list.length ? `<button class="btn btn-p" data-act="mark-all-done">Отметить все проведёнными</button>` : ""), true);
}

/* --------------------------------------------------------------- заглушки --- */
async function viewDashboard() {
  const d = await API.get("/api/dashboard");
  const maxIncome = Math.max(1, ...d.income_by_month.map((m) => m.total));

  const todayList = d.today_lessons.length
    ? d.today_lessons.map((l) => `<div class="row clickable" data-open-lesson="${l.id}">
        <div class="g"><div class="nm">${esc(l.time)} · ${esc(l.student_name)}</div>
          <div class="sb">${esc(l.topic || "тема не указана")}</div></div>
        ${statusTag(l.status)}
        ${l.status === "planned" ? `<div class="act"><button class="btn btn-s btn-p" data-act="lesson-status" data-id="${l.id}" data-status="done">Проведено</button></div>` : ""}
      </div>`).join("")
    : `<div class="empty">На сегодня занятий нет</div>`;

  const upcomingList = d.upcoming.length
    ? d.upcoming.map((l) => `<div class="row clickable" data-open-lesson="${l.id}">
        <div class="g"><div class="nm">${esc(fmtDate(l.date))}, ${esc(l.time)}</div>
          <div class="sb">${esc(l.student_name)}${l.topic ? " · " + esc(l.topic) : ""}</div></div></div>`).join("")
    : `<div class="empty">Ближайших занятий нет</div>`;

  const debtList = d.debts.length
    ? d.debts.map((x) => `<div class="row clickable" data-open-student="${x.student_id}">
        <div class="g"><div class="nm">${esc(x.student_name)}</div>
          <div class="sb">начислено ${money(x.charged)} · оплачено ${money(x.paid)}</div></div>
        ${x.debt > 0 ? `<span class="tag bad">${money(x.debt)}</span>` : `<span class="tag warn">ожидается ${money(x.pending)}</span>`}
      </div>`).join("")
    : `<div class="empty">Все рассчитались</div>`;

  const warnList = d.package_warnings.length
    ? d.package_warnings.map((p) => `<div class="row clickable" data-open-student="${p.student_id}">
        <div class="g"><div class="nm">${esc(p.student_name)}</div>
          <div class="sb">осталось ${p.left} из ${p.lessons_total}${p.expires_on ? " · до " + fmtDate(p.expires_on) : ""}</div></div>
        <span class="tag warn">${p.reason === "expiry" ? "кончается срок" : p.reason === "both" ? "и срок, и занятия" : "мало занятий"}</span>
      </div>`).join("")
    : `<div class="empty">Все абонементы в порядке</div>`;

  const hasIncome = d.income_by_month.some((m) => m.total > 0);
  const bars = !hasIncome ? `<div class="empty">Оплат пока не было</div>` : `<div class="bars">${d.income_by_month.map((m) => {
    const h = Math.max(3, Math.round((m.total / maxIncome) * 110));
    const label = m.month.slice(5) + "." + m.month.slice(2, 4);
    return `<div class="b"><div class="bv tnum">${m.total ? Math.round(m.total / 1000) + "к" : ""}</div>
      <div class="bar" style="height:${h}px"></div><div class="bl">${label}</div></div>`;
  }).join("")}</div>`;

  return head("Сводка", fmtDate(d.today),
      `${d.unmarked ? `<button class="btn" data-act="unmarked">Не отмечено: ${d.unmarked}</button>` : ""}
       <button class="btn btn-p" data-act="lesson-new" data-date="${d.today}">Новое занятие</button>`) +
    `<div class="stack">
      <div class="grid-4">
        <div class="kpi"><div class="l">Занятий на неделе</div><div class="v tnum">${d.week_count}</div><div class="n">${d.done_month} проведено за месяц</div></div>
        <div class="kpi good"><div class="l">Получено за месяц</div><div class="v tnum">${money(d.income_month)}</div><div class="n">${d.hours_month} ч занятий</div></div>
        <div class="kpi ${d.debts.length ? "bad" : "good"}"><div class="l">Задолженности</div><div class="v tnum">${d.debts.length}</div><div class="n">${d.debts.length ? "нужно напомнить" : "все рассчитались"}</div></div>
        <div class="kpi ${d.package_warnings.length ? "warn" : ""}"><div class="l">Абонементы на исходе</div><div class="v tnum">${d.package_warnings.length}</div><div class="n">${d.students_count} ${studentsWord(d.students_count)} всего</div></div>
      </div>
      <div class="grid-2">
        <div class="card"><div class="card-h"><h2>Сегодня</h2></div><div class="card-b">${todayList}</div></div>
        <div class="card"><div class="card-h"><h2>Ближайшие занятия</h2></div><div class="card-b">${upcomingList}</div></div>
      </div>
      <div class="grid-2">
        <div class="card"><div class="card-h"><h2>Кто должен</h2></div><div class="card-b">${debtList}</div></div>
        <div class="card"><div class="card-h"><h2>Абонементы на исходе</h2></div><div class="card-b">${warnList}</div></div>
      </div>
      <div class="card"><div class="card-h"><h2>Доход по месяцам</h2></div><div class="card-b">${bars}</div></div>
    </div>`;
}
async function viewPayments() {
  const [list, debts, sum] = await Promise.all([
    API.get("/api/payments"), API.get("/api/payments/debts"), API.get("/api/payments/summary"),
  ]);
  const month = todayISO().slice(0, 7);
  const thisMonth = sum.by_month.find((m) => m.month === month);

  const rows = list.length ? list.map((p) => `<tr class="clickable" data-open-payment="${p.id}">
      <td>${esc(fmtDate(p.paid_on))}</td>
      <td>${esc(p.student_name)}</td>
      <td class="tnum">${money(p.amount)}</td>
      <td>${esc(p.method || "—")}</td>
      <td>${p.status === "paid" ? '<span class="tag ok">оплачено</span>' : '<span class="tag warn">ожидается</span>'}</td>
      <td class="muted">${esc(p.note || (p.package_id ? "абонемент" : p.lesson_id ? "занятие" : ""))}</td>
    </tr>`).join("")
    : `<tr><td colspan="6"><div class="empty">Оплат пока нет</div></td></tr>`;

  const debtRows = debts.length ? debts.map((d) => `<div class="row clickable" data-open-student="${d.student_id}">
      <div class="g"><div class="nm">${esc(d.student_name)}</div>
        <div class="sb">начислено ${money(d.charged)} · оплачено ${money(d.paid)}</div></div>
      ${d.debt > 0 ? `<span class="tag bad">${money(d.debt)}</span>` : ""}
      ${d.pending > 0 ? `<span class="tag warn">ожидается ${money(d.pending)}</span>` : ""}
    </div>`).join("")
    : `<div class="empty">Задолженностей нет</div>`;

  return head("Оплаты", "История платежей и задолженности",
      `<button class="btn" data-act="export" data-what="payments">Выгрузить CSV</button>
       <button class="btn btn-p" data-act="payment-new">Записать оплату</button>`) +
    `<div class="stack">
      <div class="grid-3">
        <div class="kpi good"><div class="l">Получено за месяц</div><div class="v tnum">${money(thisMonth ? thisMonth.total : 0)}</div><div class="n">${esc(fmtMonthTitle(todayISO()))}</div></div>
        <div class="kpi ${debts.length ? "bad" : "good"}"><div class="l">Должников</div><div class="v tnum">${debts.filter((d) => d.debt > 0).length}</div><div class="n">${debts.length ? money(debts.reduce((a, d) => a + Math.max(0, d.debt), 0)) + " всего" : "все рассчитались"}</div></div>
        <div class="kpi"><div class="l">Получено всего</div><div class="v tnum">${money(sum.total)}</div><div class="n">за всё время</div></div>
      </div>
      <div class="card"><div class="card-h"><h2>Задолженности</h2></div><div class="card-b">${debtRows}</div></div>
      <div class="card"><div class="card-h"><h2>История платежей</h2></div><div class="card-b"><div class="tw">
        <table><thead><tr><th>Дата</th><th>Ученик</th><th>Сумма</th><th>Способ</th><th>Статус</th><th>Комментарий</th></tr></thead>
        <tbody>${rows}</tbody></table></div></div></div>
    </div>`;
}

async function paymentForm(payment, presetStudent) {
  if (!state.students.length) await loadStudents();
  if (!state.students.length) { studentForm(null); return; }
  const p = payment || {};
  const sid = p.student_id || presetStudent || state.students[0].id;
  const packs = await API.get(`/api/packages?student_id=${sid}`);

  modal(payment ? "Оплата" : "Новая оплата",
    `<div class="f">
      <label class="fl">Ученик<select class="inp" id="pm-student">${studentOptions(sid)}</select></label>
      <div class="f-row">
        <label class="fl">Сумма<input class="inp tnum" id="pm-amount" type="number" min="0" step="100" value="${p.amount != null ? p.amount : ""}"></label>
        <label class="fl">Дата<input class="inp" id="pm-date" type="date" value="${esc(p.paid_on || todayISO())}"></label>
      </div>
      <div class="f-row">
        <label class="fl">Способ<select class="inp" id="pm-method">
          ${["наличные", "перевод", "карта", "другое"].map((m) => `<option ${p.method === m ? "selected" : ""}>${m}</option>`).join("")}
        </select></label>
        <label class="fl">Статус<select class="inp" id="pm-status">
          <option value="paid" ${p.status !== "pending" ? "selected" : ""}>оплачено</option>
          <option value="pending" ${p.status === "pending" ? "selected" : ""}>ожидается</option>
        </select></label>
      </div>
      <label class="fl">За что<select class="inp" id="pm-package">
        <option value="">разовое занятие или без привязки</option>
        ${packs.map((k) => `<option value="${k.id}" ${String(p.package_id) === String(k.id) ? "selected" : ""}>Абонемент ${k.lessons_total} ${lessonsWord(k.lessons_total)} от ${fmtDate(k.purchased_on)}</option>`).join("")}
      </select></label>
      <label class="fl">Комментарий<input class="inp" id="pm-note" value="${esc(p.note || "")}"></label>
    </div>`,
    (payment ? `<button class="btn btn-d" data-act="payment-delete" data-id="${p.id}">Удалить</button>` : "") +
    `<button class="btn" data-act="close">Отмена</button>
     <button class="btn btn-p" data-act="submit">Сохранить</button>`);

  submitHandler = async () => {
    const payload = {
      student_id: Number(val("pm-student")),
      amount: Number(val("pm-amount")) || 0,
      paid_on: val("pm-date"),
      method: val("pm-method"),
      status: val("pm-status"),
      package_id: val("pm-package") ? Number(val("pm-package")) : null,
      note: val("pm-note"),
    };
    if (payment) await API.put(`/api/payments/${p.id}`, payload);
    else await API.post("/api/payments", payload);
    closeModal();
    await render();
    toast("Оплата сохранена");
  };
}
async function viewMaterials() {
  const list = await API.get(`/api/materials?q=${encodeURIComponent(state.materialQuery || "")}`);
  const rows = list.length ? list.map((m) => `<div class="row">
      <div class="g"><div class="nm">${m.kind === "file" ? "📄" : "🔗"} ${esc(m.title)}</div>
        <div class="sb">${esc([m.student_name, m.lesson ? fmtDate(m.lesson.date) : "", m.note].filter(Boolean).join(" · ") || "без привязки")}</div></div>
      <a class="btn btn-s" href="${esc(m.download_url)}" target="_blank" rel="noopener">Открыть</a>
      <div class="act"><button class="btn btn-s btn-d" data-act="material-delete" data-id="${m.id}">Удалить</button></div>
    </div>`).join("")
    : `<div class="empty"><b>Материалов пока нет</b>Добавьте ссылку или загрузите файл.</div>`;

  return head("Материалы", `${list.length} в библиотеке`,
      `<input class="inp search" id="matSearch" placeholder="Поиск по названию" value="${esc(state.materialQuery || "")}">
       <button class="btn" data-act="material-link">Добавить ссылку</button>
       <button class="btn btn-p" data-act="material-upload">Загрузить файл</button>`) +
    `<div class="card"><div class="card-b">${rows}</div></div>`;
}

async function materialLinkForm(studentId, lessonId) {
  if (!state.students.length) await loadStudents();
  modal("Ссылка на материал",
    `<div class="f">
      <label class="fl">Название<input class="inp" id="ml-title" placeholder="Unit 5, упражнения"></label>
      <label class="fl">Ссылка<input class="inp" id="ml-url" placeholder="https://..."></label>
      <label class="fl">Ученик<select class="inp" id="ml-student"><option value="">без привязки</option>${studentOptions(studentId)}</select></label>
      <label class="fl">Заметка<input class="inp" id="ml-note"></label>
    </div>`,
    `<button class="btn" data-act="close">Отмена</button><button class="btn btn-p" data-act="submit">Сохранить</button>`);
  submitHandler = async () => {
    await API.post("/api/materials/link", {
      title: val("ml-title"), url: val("ml-url"),
      student_id: val("ml-student") ? Number(val("ml-student")) : null,
      lesson_id: lessonId ? Number(lessonId) : null, note: val("ml-note"),
    });
    closeModal(); await render(); toast("Материал добавлен");
  };
}

function uploadMaterial(studentId, lessonId, done) {
  const inp = $("filePick");
  inp.value = "";
  pendingPick = async (files) => {
    for (const f of files) {
      const form = new FormData();
      form.append("file", f);
      form.append("title", f.name);
      if (studentId) form.append("student_id", String(studentId));
      if (lessonId) form.append("lesson_id", String(lessonId));
      const r = await fetch("/api/materials/upload", { method: "POST", body: form });
      if (!r.ok) { toast(r.status === 413 ? "Файл больше 50 МБ" : "Не удалось загрузить"); }
    }
    toast("Загружено");
    if (done) await done(); else await render();
  };
  inp.click();
}

let pendingPick = null;
document.addEventListener("DOMContentLoaded", () => {
  const inp = $("filePick");
  if (inp) inp.addEventListener("change", async function () {
    const cb = pendingPick; pendingPick = null;
    if (cb) await cb(Array.from(this.files));
  });
});
async function viewSettings() {
  const backups = await API.get("/api/backups");
  const list = backups.items.length
    ? backups.items.map((b) => `<div class="row"><div class="g"><div class="nm">${esc(b.file)}</div>
        <div class="sb">${esc(b.made)} · ${(b.size / 1024).toFixed(0)} КБ</div></div></div>`).join("")
    : `<div class="empty">Копий пока нет</div>`;

  return head("Настройки", "Валюта, значения по умолчанию, выгрузка и резервные копии") +
    `<div class="stack">
      <div class="card"><div class="card-h"><h2>Основное</h2></div><div class="card-b">
        <div class="f" style="padding:10px 0">
          <div class="f-row-3">
            <label class="fl">Валюта<input class="inp" id="se-currency" value="${esc(state.settings.currency)}"></label>
            <label class="fl">Длительность занятия, мин<input class="inp tnum" id="se-duration" type="number" min="15" step="15" value="${esc(state.settings.default_duration)}"></label>
            <label class="fl">Ваше имя<input class="inp" id="se-teacher" value="${esc(state.settings.teacher_name || "")}"></label>
          </div>
          <label class="check"><input type="checkbox" id="se-noshow" ${String(state.settings.no_show_counts) !== "0" ? "checked" : ""}>Пропущенное занятие списывается с абонемента</label>
          <p class="hint">Снимите галочку, если пропуск вы не считаете и возвращаете занятие ученику.</p>
          <button class="btn btn-p" data-act="settings-save" style="align-self:flex-start">Сохранить</button>
        </div></div></div>

      <div class="card"><div class="card-h"><h2>Выгрузка в CSV</h2></div><div class="card-b">
        <p class="hint" style="padding:10px 0">Файлы открываются в Excel и Numbers.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;padding-bottom:12px">
          <button class="btn" data-act="export" data-what="students">Ученики</button>
          <button class="btn" data-act="export" data-what="lessons">Занятия</button>
          <button class="btn" data-act="export" data-what="packages">Абонементы</button>
          <button class="btn" data-act="export" data-what="payments">Оплаты</button>
          <button class="btn" data-act="export" data-what="materials">Материалы</button>
        </div></div></div>

      <div class="card"><div class="card-h"><h2>Резервные копии</h2>
        <button class="btn btn-p btn-s" data-act="backup">Сделать копию</button></div>
        <div class="card-b">
          <p class="hint" style="padding:10px 0">Копии лежат в папке <code>${esc(backups.folder)}</code>. Хранятся последние 30.</p>
          ${list}
        </div></div>
    </div>`;
}

/* ------------------------------------------------------------- отрисовка --- */
const VIEWS = {
  dashboard: viewDashboard, students: viewStudents, calendar: viewCalendar,
  payments: viewPayments, materials: viewMaterials, settings: viewSettings,
};

async function render() {
  renderMenu();
  try {
    $("view").innerHTML = await VIEWS[state.tab]();
  } catch (e) {
    $("view").innerHTML = head("Ошибка", String(e.message || e));
  }
  renderMenu();
  const ms = $("matSearch");
  if (ms) {
    ms.addEventListener("input", debounce(async () => {
      state.materialQuery = ms.value;
      await render();
      const again = $("matSearch");
      if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
    }, 250));
  }
  const s = $("stSearch");
  if (s) {
    s.addEventListener("input", debounce(async () => {
      state.studentQuery = s.value;
      await render();
      const again = $("stSearch");
      if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
    }, 250));
  }
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ---------------------------------------------------------------- клики --- */
document.addEventListener("click", async (e) => {
  const tabBtn = e.target.closest("[data-tab]");
  if (tabBtn) { state.tab = tabBtn.dataset.tab; await render(); return; }

  const openStudentEl = e.target.closest("[data-open-student]");
  if (openStudentEl && !e.target.closest("[data-act]")) {
    await openStudent(openStudentEl.dataset.openStudent);
    return;
  }

  const openPaymentEl = e.target.closest("[data-open-payment]");
  if (openPaymentEl) {
    const all = await API.get("/api/payments");
    const found = all.find((x) => String(x.id) === openPaymentEl.dataset.openPayment);
    if (found) await paymentForm(found);
    return;
  }

  const viewEl = e.target.closest("[data-view]");
  if (viewEl) { openViewer(viewEl.dataset.view, viewEl.dataset.title, viewEl.dataset.mime); return; }

  const openLessonEl = e.target.closest("[data-open-lesson]");
  if (openLessonEl) { await openLesson(openLessonEl.dataset.openLesson); return; }

  const el = e.target.closest("[data-act]");
  if (!el) { if (e.target.id === "overlay") closeModal(); return; }
  const act = el.dataset.act;

  try {
    switch (act) {
      case "close": closeModal(); break;
      case "submit": if (submitHandler) await submitHandler(); break;

      case "student-new": studentForm(null); break;
      case "student-edit": {
        const s = await API.get(`/api/students/${el.dataset.id}`);
        studentForm(s);
        break;
      }
      case "student-delete": {
        if (!confirm("Удалить ученика со всеми занятиями, оплатами и материалами? Отменить будет нельзя.")) break;
        await API.del(`/api/students/${el.dataset.id}`);
        closeModal(); await render(); toast("Ученик удалён");
        break;
      }
      case "toggle-archived": state.showArchived = !state.showArchived; await render(); break;

      case "portal-share": await portalShare(el.dataset.id); break;
      case "portal-reset": {
        if (!confirm("Сменить код и ссылку? Старая ссылка перестанет работать.")) break;
        await API.post(`/api/students/${el.dataset.id}/portal/reset`, {});
        await portalShare(el.dataset.id);
        toast("Код обновлён");
        break;
      }
      case "copy-portal": {
        const ta = $("pl-text");
        if (ta) { ta.select(); try { document.execCommand("copy"); } catch (e) {} toast("Скопировано"); }
        break;
      }
      case "chat-send": {
        const box = $("ch-text"), text = box ? box.value.trim() : "";
        if (!text) break;
        await API.post(`/api/students/${el.dataset.id}/messages`, { text });
        await openStudent(el.dataset.id);
        break;
      }
      case "chat-file": {
        const sid = el.dataset.id;
        uploadMaterial(sid, null, async () => {
          const mats = await API.get(`/api/materials?student_id=${sid}`);
          if (mats[0]) await API.post(`/api/students/${sid}/messages`, { text: "", material_id: mats[0].id });
          await openStudent(sid);
        });
        break;
      }

      case "material-link": await materialLinkForm(el.dataset.student); break;
      case "material-upload": {
        const sid = el.dataset.student;
        uploadMaterial(sid, null, sid ? () => openStudent(sid) : null);
        break;
      }
      case "material-delete": {
        if (!confirm("Удалить материал?")) break;
        await API.del(`/api/materials/${el.dataset.id}`);
        await render(); toast("Материал удалён");
        break;
      }
      case "export": window.location.href = `/api/export/${el.dataset.what}.csv`; break;
      case "backup": {
        const r = await API.post("/api/backup", {});
        await render();
        toast("Копия сохранена: " + r.file);
        break;
      }
      case "settings-save": {
        state.settings = await API.put("/api/settings", {
          currency: val("se-currency") || "֏",
          default_duration: val("se-duration") || "60",
          teacher_name: val("se-teacher"),
          no_show_counts: checked("se-noshow") ? "1" : "0",
        });
        await render(); toast("Сохранено");
        break;
      }

      case "payment-new": await paymentForm(null, el.dataset.student); break;
      case "payment-delete": {
        if (!confirm("Удалить запись об оплате?")) break;
        await API.del(`/api/payments/${el.dataset.id}`);
        closeModal(); await render(); toast("Оплата удалена");
        break;
      }

      case "package-new": packageForm(el.dataset.student); break;
      case "package-delete": {
        if (!confirm("Удалить абонемент? Занятия останутся, но перестанут быть к нему привязаны.")) break;
        await API.del(`/api/packages/${el.dataset.id}`);
        await openStudent(el.dataset.student);
        toast("Абонемент удалён");
        break;
      }

      case "lesson-new": await lessonForm(null, el.dataset.date, el.dataset.student); break;
      case "lesson-delete": {
        if (!confirm("Удалить занятие?")) break;
        await API.del(`/api/lessons/${el.dataset.id}`);
        closeModal(); await render(); toast("Занятие удалено");
        break;
      }
      case "lesson-status": {
        await API.post(`/api/lessons/${el.dataset.id}/status`, { status: el.dataset.status });
        if (el.dataset.stay) { await unmarkedModal(); await renderQuiet(); }
        else { closeModal(); await render(); }
        toast(statusText(el.dataset.status));
        break;
      }
      case "lesson-move": closeModal(); moveForm(el.dataset.id); break;
      case "unmarked": await unmarkedModal(); break;
      case "mark-all-done": {
        const list = await API.get("/api/lessons/unmarked");
        for (const l of list) await API.post(`/api/lessons/${l.id}/status`, { status: "done" });
        closeModal(); await render(); toast("Отмечено");
        break;
      }

      case "cal-mode": state.calMode = el.dataset.mode; await render(); break;
      case "cal-prev": state.anchor = state.calMode === "month" ? addMonths(state.anchor, -1) : addDays(state.anchor, -7); await render(); break;
      case "cal-next": state.anchor = state.calMode === "month" ? addMonths(state.anchor, 1) : addDays(state.anchor, 7); await render(); break;
      case "cal-today": state.anchor = todayISO(); await render(); break;
      case "goto-week": state.anchor = el.dataset.date; state.calMode = "week"; await render(); break;
    }
  } catch (err) {
    toast(String(err.message || err));
  }
});

async function renderQuiet() {
  const open = $("overlay").classList.contains("on");
  const html = await VIEWS[state.tab]();
  $("view").innerHTML = html;
  renderMenu();
  if (open) $("overlay").classList.add("on");
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
  if (e.key === "Enter" && submitHandler && $("overlay").classList.contains("on")
      && e.target.tagName !== "TEXTAREA") {
    e.preventDefault();
    submitHandler();
  }
});

/* ----------------------------------------------------------------- старт --- */
(async function start() {
  state.anchor = todayISO();
  try { state.settings = await API.get("/api/settings"); } catch (e) {}
  await loadStudents();
  await render();
})();
