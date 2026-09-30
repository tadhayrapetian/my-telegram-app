/* Кабинет ученика: остаток занятий, расписание, домашка, материалы, переписка. */

const token = location.pathname.replace(/^\/s\//, "");
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let DATA = null;
let pendingPick = null;

const parseDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
function fmtDate(s) {
  if (!s) return "";
  try { return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(parseDate(s)); }
  catch (e) { return s; }
}
function fmtWhen(ts) {
  try {
    return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
      .format(new Date(ts));
  } catch (e) { return ""; }
}
const money = (n, cur) => (Math.round(+n || 0)).toLocaleString("ru-RU") + " " + (cur || "");
const plural = (n, a, b, c) => {
  const x = Math.abs(n) % 100, y = x % 10;
  if (x > 10 && x < 20) return c;
  if (y > 1 && y < 5) return b;
  return y === 1 ? a : c;
};
const fileIcon = (mime) => /^image\//.test(mime || "") ? "🖼"
  : mime === "application/pdf" ? "📄"
  : /^audio\//.test(mime || "") ? "🎧"
  : /^video\//.test(mime || "") ? "🎬" : "📎";

/* ------------------------------------------------------------- вход --- */
function askCode(error) {
  $("pview").innerHTML =
    `<div class="card" style="max-width:380px;margin:40px auto">
      <div class="card-h"><h2>Ваши занятия</h2></div>
      <div class="card-b"><div class="f" style="padding:14px 0">
        ${error ? `<div class="tag bad" style="padding:9px 12px">${esc(error)}</div>` : ""}
        <p class="hint">Введите код, который дал преподаватель.</p>
        <input class="inp tnum" id="code" inputmode="numeric" placeholder="••••"
               style="font-size:20px;letter-spacing:.2em;text-align:center">
        <button class="btn btn-p" id="go">Открыть</button>
      </div></div></div>`;
  const input = $("code");
  input.focus();
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") enter(); });
  $("go").addEventListener("click", enter);
}

async function enter() {
  const code = ($("code") || {}).value || "";
  const r = await fetch("/api/portal", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, code: code.trim() }),
  });
  if (r.status === 404) return askCode("Ссылка больше не работает");
  if (!r.ok) return askCode("Неверный код");
  show(await r.json());
}

async function reload() {
  const r = await fetch("/api/portal/data");
  if (r.ok) show(await r.json());
}

/* --------------------------------------------------------- просмотр --- */
function openViewer(url, title, mime) {
  $("viewerBox").innerHTML =
    (/^image\//.test(mime || "")
      ? `<img src="${esc(url)}" alt="" style="max-width:100%;border-radius:12px;display:block;margin:0 auto">`
      : mime === "application/pdf"
        ? `<iframe src="${esc(url)}" style="width:100%;height:min(72vh,680px);border:1px solid var(--line);border-radius:12px;background:#fff"></iframe>`
        : `<div class="empty"><b>${esc(title)}</b>Файл откроется в новой вкладке</div>`) +
    `<div class="bar"><button class="btn" id="v-close">Назад</button>
      <a class="btn" href="${esc(url)}" target="_blank" rel="noopener">Открыть отдельно</a>
      <a class="btn btn-p" href="${esc(url)}" download="${esc(title)}">Скачать</a></div>`;
  $("viewer").classList.add("on");
  $("v-close").onclick = () => $("viewer").classList.remove("on");
}

/* ------------------------------------------------------- загрузка --- */
function pick(kind) {
  const inp = $("pfile");
  inp.value = "";
  inp.accept = kind === "photo" ? "image/*" : "";
  pendingPick = kind;
  inp.click();
}

$("pfile").addEventListener("change", async function () {
  const kind = pendingPick; pendingPick = null;
  const file = this.files[0];
  if (!file) return;
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);
  const r = await fetch("/api/portal/upload", { method: "POST", body: form });
  if (!r.ok) alert(r.status === 413 ? "Файл больше 50 МБ" : "Не удалось отправить файл");
  await reload();
});

async function sendMessage() {
  const box = $("m-text");
  const text = (box.value || "").trim();
  if (!text) return;
  box.value = "";
  await fetch("/api/portal/message", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  await reload();
}

/* --------------------------------------------------------- отрисовка --- */
function show(d) {
  DATA = d;
  const left = d.lessons_left;
  const lessonsWord = plural(left, "занятие", "занятия", "занятий");

  $("pview").innerHTML =
    `<div class="ava-wrap">
      ${d.photo_url ? `<img class="ava-img" src="${esc(d.photo_url)}" alt="">` : `<div class="ava-ph">🙂</div>`}
      <button class="btn" id="ph-add">${d.photo_url ? "Изменить фото" : "Добавить фото"}</button>
    </div>

    <div class="phead"><div><h1>${esc(d.student.name)}</h1>
      <div class="sub muted">${esc(d.student.level || "")}</div></div>
      ${d.teacher ? `<div class="muted" style="font-size:13px">Преподаватель: ${esc(d.teacher)}</div>` : ""}</div>

    <div class="grid-2" style="margin-bottom:15px">
      <div class="kpi ${left <= 0 ? "bad" : left <= 2 ? "warn" : "good"}">
        <div class="l">Осталось занятий</div><div class="v tnum">${left}</div>
        <div class="n">${d.pack_until ? "абонемент до " + fmtDate(d.pack_until) : lessonsWord}</div></div>
      <div class="kpi ${d.debt > 0 ? "bad" : "good"}">
        <div class="l">Задолженность</div><div class="v tnum">${d.debt > 0 ? money(d.debt, d.currency) : "нет"}</div>
        <div class="n">${d.debt > 0 ? "нужно оплатить" : "всё оплачено"}</div></div>
    </div>

    <div class="card"><div class="card-h"><h2>Ближайшие занятия</h2></div><div class="card-b">
      ${d.upcoming.length ? d.upcoming.map((l) => `<div class="row">
        <div class="g"><div class="nm">${esc(fmtDate(l.date))}, ${esc(l.time)}</div>
          <div class="sb">${esc([l.topic, l.homework ? "д/з: " + l.homework : ""].filter(Boolean).join(" · ") || "тема будет позже")}</div></div>
      </div>`).join("") : `<div class="empty">Занятий пока не назначено</div>`}
    </div></div>

    <div class="card"><div class="card-h"><h2>Материалы</h2>
      <button class="btn btn-s" id="f-add">Отправить файл</button></div><div class="card-b">
      ${d.materials.length ? d.materials.map((m) => `<div class="row">
        <div class="g"><div class="nm">${fileIcon(m.mime)} ${esc(m.title)}</div>
          <div class="sb">${esc(fmtWhen(m.created_at))}</div></div>
        <button class="btn btn-s" data-open="${esc(m.open_url)}" data-title="${esc(m.title)}" data-mime="${esc(m.mime || "")}">Открыть</button>
      </div>`).join("") : `<div class="empty">Материалов пока нет</div>`}
    </div></div>

    <div class="card"><div class="card-h"><h2>Переписка с преподавателем</h2></div><div class="card-b">
      <div class="chat">
        ${d.messages.length ? d.messages.map((m) => `<div class="msg ${m.author === "student" ? "me" : ""}">
          ${m.text ? `<div class="tx">${esc(m.text)}</div>` : ""}
          ${m.file ? `<button class="msg-file" data-open="${esc(m.file.open_url)}" data-title="${esc(m.file.title)}" data-mime="${esc(m.file.mime || "")}">${fileIcon(m.file.mime)} ${esc(m.file.title)}</button>` : ""}
          <div class="wh">${m.author === "student" ? "Вы" : esc(d.teacher || "Преподаватель")} · ${esc(fmtWhen(m.created))}</div>
        </div>`).join("") : `<div class="empty">Сообщений пока нет</div>`}
      </div>
      <div class="chat-send">
        <input class="inp" id="m-text" placeholder="Написать сообщение">
        <button class="icon-btn" id="m-file">📎</button>
        <button class="btn btn-p" id="m-send">Отправить</button>
      </div>
    </div></div>

    ${d.payments.length ? `<div class="card"><div class="card-h"><h2>Оплаты</h2></div><div class="card-b">
      ${d.payments.map((p) => `<div class="row"><div class="g">
        <div class="nm">${money(p.amount, d.currency)}</div>
        <div class="sb">${esc(fmtDate(p.paid_on))}${p.method ? " · " + esc(p.method) : ""}</div></div>
        ${p.status === "paid" ? '<span class="tag ok">оплачено</span>' : '<span class="tag warn">ожидается</span>'}
      </div>`).join("")}
    </div></div>` : ""}`;

  $("ph-add").onclick = () => pick("photo");
  $("f-add").onclick = () => pick("file");
  $("m-send").onclick = sendMessage;
  $("m-file").onclick = () => pick("file");
  $("m-text").addEventListener("keydown", (e) => { if (e.key === "Enter") sendMessage(); });
  document.querySelectorAll("[data-open]").forEach((b) => {
    b.onclick = () => openViewer(b.dataset.open, b.dataset.title, b.dataset.mime);
  });
  const chat = document.querySelector(".chat");
  if (chat) chat.scrollTop = chat.scrollHeight;
}

/* если код уже вводили — открываем сразу */
fetch("/api/portal/data")
  .then((r) => (r.ok ? r.json().then(show) : askCode()))
  .catch(() => askCode());
