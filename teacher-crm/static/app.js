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
  tab: "students",
  settings: { currency: "֏", default_duration: "60", default_price: "0", teacher_name: "" },
  students: [],
  calMode: "week",
  anchor: "",            // любая дата внутри показываемой недели или месяца
  studentQuery: "",
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
  </div>`;
}

async function viewStudents() {
  await loadStudents();
  const body = state.students.length
    ? state.students.map(studentRow).join("")
    : `<div class="empty"><b>Учеников пока нет</b>Добавьте первого — это полминуты.</div>`;

  return head("Ученики", `${state.students.length} в списке`,
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

async function openStudent(id) {
  const s = await API.get(`/api/students/${id}`);
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

      <div class="card"><div class="card-h"><h2>Журнал занятий</h2>
        <button class="btn btn-s btn-p" data-act="lesson-new" data-student="${s.id}">Добавить занятие</button></div>
        <div class="card-b">${lessonsList}</div></div>
    </div>`,
    `<button class="btn" data-act="student-edit" data-id="${s.id}">Изменить</button>
     <button class="btn" data-act="close">Закрыть</button>`, true);
}

/* ------------------------------------------------------------ календарь --- */
function statusTag(status) {
  const map = {
    planned:   '<span class="tag mut">запланировано</span>',
    done:      '<span class="tag ok">проведено</span>',
    cancelled: '<span class="tag bad">отменено</span>',
    moved:     '<span class="tag warn">перенесено</span>',
  };
  return map[status] || "";
}

function lessonCard(l) {
  return `<div class="lsn ${l.status}" data-open-lesson="${l.id}">
    <div class="t tnum">${esc(l.time)}</div>
    <div class="n">${esc(l.student_name)}</div>
    <div class="s">${esc(l.topic || statusText(l.status))}</div></div>`;
}
function statusText(s) {
  return { planned: "запланировано", done: "проведено", cancelled: "отменено", moved: "перенесено" }[s] || "";
}

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
      ${!isNew && l.moved_from ? `<div class="chain">Перенесено с ${esc(fmtDate(l.moved_from.date))}, ${esc(l.moved_from.time)}${l.move_reason ? " · причина: " + esc(l.move_reason) : ""}</div>` : ""}
      ${!isNew && l.moved_to ? `<div class="chain">Перенесено на ${esc(fmtDate(l.moved_to.date))}, ${esc(l.moved_to.time)}</div>` : ""}
    </div>`,
    (isNew ? "" :
      `<button class="btn btn-d" data-act="lesson-delete" data-id="${l.id}">Удалить</button>
       <button class="btn" data-act="lesson-move" data-id="${l.id}">Перенести</button>
       ${l.status === "planned"
         ? `<button class="btn" data-act="lesson-status" data-id="${l.id}" data-status="cancelled">Отменить</button>
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
      <label class="fl">Причина переноса<input class="inp" id="mv-reason" placeholder="Ученик заболел"></label>
      <p class="hint">Старое занятие останется в истории со статусом «перенесено», новое будет на него ссылаться.</p>
    </div>`,
    `<button class="btn" data-act="close">Отмена</button>
     <button class="btn btn-p" data-act="submit">Перенести</button>`);
  submitHandler = async () => {
    await API.post(`/api/lessons/${id}/move`, {
      date: val("mv-date"), time: val("mv-time") || null, reason: val("mv-reason"),
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
          <button class="btn btn-s" data-act="lesson-status" data-id="${l.id}" data-status="cancelled" data-stay="1">Отменено</button>
        </div></div>`).join("") : `<div class="empty">Всё прошедшее отмечено</div>`) +
    `</div></div>`,
    `<button class="btn" data-act="close">Закрыть</button>` +
    (list.length ? `<button class="btn btn-p" data-act="mark-all-done">Отметить все проведёнными</button>` : ""), true);
}

/* --------------------------------------------------------------- заглушки --- */
async function viewDashboard() { return head("Сводка", "раздел готовится"); }
async function viewPayments()  { return head("Оплаты", "раздел готовится"); }
async function viewMaterials() { return head("Материалы", "раздел готовится"); }
async function viewSettings()  { return head("Настройки", "раздел готовится"); }

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
  if (openStudentEl) { await openStudent(openStudentEl.dataset.openStudent); return; }

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
