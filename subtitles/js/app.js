// Точка входа: интерфейс, превью, редактор реплик, экспорт.

import {
  state, saveSettings, loadSettings, FONTS,
  DEFAULT_STYLE, DEFAULT_SEG, listPresets, savePreset, deletePreset, BUILT_IN_PRESETS,
} from './store.js';
import { transcribe } from './asr.js';
import { applyDictionary, buildCues, cueText, retimeCueText, splitCue, mergeCues, parseSubtitleFile } from './text.js';
import { drawCue, cueAt, fontString } from './renderer.js';
import { toSRT, toVTT, toASS, toProjectJSON, download } from './exporters.js';
import { burnIn, canBurn, pickMime } from './burn.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const video = $('#video');
const overlay = $('#overlay');
const octx = overlay.getContext('2d');

let autoRebuild = true;
let showGuides = false;

/* ------------------------------------------------------------------ */
/*  Утилиты интерфейса                                                 */
/* ------------------------------------------------------------------ */

let toastTimer = 0;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', isError);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), isError ? 7000 : 3000);
}

function progress(show, title = '', p = 0) {
  $('#progressWrap').classList.toggle('show', show);
  if (title) $('#progressTitle').textContent = title;
  $('#progressBar').style.width = `${Math.round(p * 100)}%`;
}

function fmtTime(t) {
  if (!Number.isFinite(t)) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/*  Генератор контролов                                                */
/* ------------------------------------------------------------------ */

function control(item, obj, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'ctrl';
  const id = `c_${item.k}`;

  if (item.t === 'bool') {
    wrap.classList.add('inline');
    wrap.innerHTML = `<label for="${id}">${item.label}</label>
      <span class="switch"><input type="checkbox" id="${id}"><span></span></span>`;
    const inp = wrap.querySelector('input');
    inp.checked = !!obj[item.k];
    inp.addEventListener('change', () => { obj[item.k] = inp.checked; onChange(item.k); });
    return wrap;
  }

  if (item.t === 'select') {
    wrap.innerHTML = `<label for="${id}">${item.label}</label>
      <select id="${id}">${item.opts.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select>`;
    const sel = wrap.querySelector('select');
    sel.value = String(obj[item.k]);
    sel.addEventListener('change', () => {
      const raw = sel.value;
      obj[item.k] = item.num ? Number(raw) : raw;
      onChange(item.k);
    });
    return wrap;
  }

  if (item.t === 'color') {
    wrap.innerHTML = `<label>${item.label}</label>
      <div class="row">
        <input type="color" id="${id}">
        <input type="text" id="${id}_hex" spellcheck="false" style="max-width:96px">
        ${item.op ? `<input type="range" id="${id}_op" min="0" max="100" step="1" title="Прозрачность"><span class="val" id="${id}_opv"></span>` : ''}
      </div>`;
    const col = wrap.querySelector(`#${id}`);
    const hex = wrap.querySelector(`#${id}_hex`);
    col.value = obj[item.k]; hex.value = obj[item.k];
    col.addEventListener('input', () => { obj[item.k] = col.value; hex.value = col.value; onChange(item.k); });
    hex.addEventListener('change', () => {
      const v = hex.value.trim();
      if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) { obj[item.k] = v; col.value = v; onChange(item.k); }
      else hex.value = obj[item.k];
    });
    if (item.op) {
      const op = wrap.querySelector(`#${id}_op`);
      const opv = wrap.querySelector(`#${id}_opv`);
      op.value = obj[item.op];
      opv.textContent = `${obj[item.op]}%`;
      op.addEventListener('input', () => {
        obj[item.op] = +op.value; opv.textContent = `${op.value}%`; onChange(item.op);
      });
    }
    return wrap;
  }

  if (item.t === 'text' || item.t === 'password' || item.t === 'area') {
    const tag = item.t === 'area' ? 'textarea' : 'input';
    wrap.innerHTML = `<label for="${id}">${item.label}</label>
      <${tag} id="${id}" ${item.t === 'area' ? '' : `type="${item.t}"`} placeholder="${item.ph || ''}" spellcheck="false"></${tag}>`;
    const inp = wrap.querySelector(`#${id}`);
    inp.value = obj[item.k] ?? '';
    inp.addEventListener('input', () => { obj[item.k] = inp.value; onChange(item.k); });
    if (item.hint) wrap.insertAdjacentHTML('beforeend', `<div class="hint">${item.hint}</div>`);
    return wrap;
  }

  // range + число
  const dec = (String(item.step || 1).split('.')[1] || '').length;
  wrap.innerHTML = `
    <div class="head"><label for="${id}">${item.label}</label><span class="val" id="${id}_v"></span></div>
    <div class="row">
      <input type="range" id="${id}" min="${item.min}" max="${item.max}" step="${item.step}">
      <input type="number" id="${id}_n" min="${item.min}" max="${item.max}" step="${item.step}" style="max-width:74px">
    </div>`;
  const rng = wrap.querySelector(`#${id}`);
  const num = wrap.querySelector(`#${id}_n`);
  const val = wrap.querySelector(`#${id}_v`);
  const show = () => { val.textContent = `${(+obj[item.k]).toFixed(dec)}${item.unit || ''}`; };
  rng.value = obj[item.k]; num.value = obj[item.k]; show();
  const set = (v) => {
    const n = Math.min(item.max, Math.max(item.min, Number(v)));
    if (!Number.isFinite(n)) return;
    obj[item.k] = n; rng.value = n; num.value = n; show(); onChange(item.k);
  };
  rng.addEventListener('input', () => set(rng.value));
  num.addEventListener('input', () => set(num.value));
  return wrap;
}

function renderGroups(container, schema, obj, onChange) {
  container.innerHTML = '';
  schema.forEach((g, i) => {
    const d = document.createElement('details');
    d.className = 'group';
    if (g.open ?? i === 0) d.open = true;
    d.innerHTML = `<summary>${g.title}</summary><div class="body"></div>`;
    const body = d.querySelector('.body');
    g.items.forEach((it) => body.appendChild(control(it, obj, onChange)));
    if (g.note) body.insertAdjacentHTML('beforeend', `<div class="hint">${g.note}</div>`);
    container.appendChild(d);
  });
}

/* ------------------------------------------------------------------ */
/*  Схемы настроек                                                     */
/* ------------------------------------------------------------------ */

const STYLE_SCHEMA = [
  {
    title: '🔤 Шрифт',
    items: [
      { k: 'fontFamily', t: 'select', label: 'Гарнитура', opts: FONTS.map((f) => [f.id, f.name]) },
      { k: 'fontSize', t: 'range', label: 'Размер', min: 1.5, max: 20, step: 0.1, unit: '% высоты кадра' },
      { k: 'fontWeight', t: 'select', label: 'Насыщенность', num: true, opts: [[300, 'Тонкий'], [400, 'Обычный'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extrabold'], [900, 'Black']] },
      { k: 'italic', t: 'bool', label: 'Курсив' },
      { k: 'uppercase', t: 'bool', label: 'ВСЁ ЗАГЛАВНЫМИ' },
      { k: 'letterSpacing', t: 'range', label: 'Межбуквенный интервал', min: -10, max: 40, step: 0.5, unit: '%' },
      { k: 'wordSpacing', t: 'range', label: 'Пробел между словами', min: -50, max: 200, step: 1, unit: '%' },
      { k: 'lineHeight', t: 'range', label: 'Межстрочный интервал', min: 0.8, max: 2.5, step: 0.01, unit: '' },
      { k: 'autoShrink', t: 'bool', label: 'Уменьшать кегль, если не влезает' },
    ],
    note: 'Для армянского текста берите Noto Sans/Serif Armenian или загрузите свой шрифт во вкладке «Видео».',
  },
  {
    title: '🎨 Цвет текста',
    items: [
      { k: 'color', t: 'color', label: 'Основной цвет', op: 'colorOpacity' },
      { k: 'colorActive', t: 'color', label: 'Цвет текущего слова' },
      { k: 'colorSpoken', t: 'color', label: 'Цвет уже сказанных слов (режим «прогресс»)' },
    ],
  },
  {
    title: '⭕ Обводка',
    items: [
      { k: 'outlineWidth', t: 'range', label: 'Толщина обводки', min: 0, max: 40, step: 0.5, unit: '% кегля' },
      { k: 'outlineColor', t: 'color', label: 'Цвет обводки', op: 'outlineOpacity' },
    ],
  },
  {
    title: '🌑 Тень',
    items: [
      { k: 'shadowOn', t: 'bool', label: 'Включить тень' },
      { k: 'shadowColor', t: 'color', label: 'Цвет тени', op: 'shadowOpacity' },
      { k: 'shadowBlur', t: 'range', label: 'Размытие', min: 0, max: 120, step: 1, unit: '%' },
      { k: 'shadowX', t: 'range', label: 'Смещение по X', min: -60, max: 60, step: 1, unit: '%' },
      { k: 'shadowY', t: 'range', label: 'Смещение по Y', min: -60, max: 60, step: 1, unit: '%' },
    ],
  },
  {
    title: '🟪 Плашка (фон)',
    items: [
      { k: 'bgMode', t: 'select', label: 'Режим плашки', opts: [['none', 'Без плашки'], ['block', 'Одна на весь блок'], ['line', 'По строкам'], ['word', 'По словам']] },
      { k: 'bgColor', t: 'color', label: 'Цвет плашки', op: 'bgOpacity' },
      { k: 'bgPadX', t: 'range', label: 'Отступ по горизонтали', min: 0, max: 200, step: 1, unit: '% кегля' },
      { k: 'bgPadY', t: 'range', label: 'Отступ по вертикали', min: 0, max: 200, step: 1, unit: '% кегля' },
      { k: 'bgRadius', t: 'range', label: 'Скругление углов', min: 0, max: 100, step: 1, unit: '% кегля' },
    ],
  },
  {
    title: '📐 Положение на кадре',
    items: [
      { k: 'align', t: 'select', label: 'Выравнивание', opts: [['left', 'По левому краю'], ['center', 'По центру'], ['right', 'По правому краю']] },
      { k: 'posY', t: 'range', label: 'Позиция по вертикали', min: 2, max: 98, step: 0.5, unit: '% от верха' },
      { k: 'offsetX', t: 'range', label: 'Сдвиг по горизонтали', min: -45, max: 45, step: 0.5, unit: '%' },
      { k: 'maxWidth', t: 'range', label: 'Максимальная ширина', min: 20, max: 100, step: 1, unit: '% кадра' },
      { k: 'maxLines', t: 'range', label: 'Максимум строк', min: 1, max: 5, step: 1, unit: '' },
    ],
  },
  {
    title: '✨ Анимация и караоке',
    items: [
      { k: 'appear', t: 'select', label: 'Появление реплики', opts: [['none', 'Без анимации'], ['fade', 'Плавно'], ['pop', 'С «подскоком»'], ['slideUp', 'Снизу вверх'], ['typewriter', 'Слово за словом']] },
      { k: 'appearMs', t: 'range', label: 'Длительность анимации', min: 0, max: 1200, step: 10, unit: ' мс' },
      { k: 'popScale', t: 'range', label: 'Стартовый масштаб («подскок»)', min: 0.3, max: 1, step: 0.01, unit: '' },
      { k: 'slidePx', t: 'range', label: 'Дистанция сдвига', min: 0, max: 40, step: 0.5, unit: '% кегля' },
      { k: 'karaoke', t: 'select', label: 'Подсветка слов', opts: [['off', 'Выключена'], ['active', 'Только текущее слово'], ['progressive', 'Заливка по мере речи']] },
      { k: 'activeScale', t: 'range', label: 'Увеличение текущего слова', min: 100, max: 160, step: 1, unit: '%' },
      { k: 'activeBox', t: 'bool', label: 'Плашка под текущим словом' },
      { k: 'activeBoxColor', t: 'color', label: 'Цвет плашки под словом', op: 'activeBoxOpacity' },
    ],
  },
];

const SEG_SCHEMA = [
  {
    title: '✂️ Разбивка на реплики',
    items: [
      { k: 'maxWords', t: 'range', label: 'Максимум слов в реплике', min: 1, max: 20, step: 1, unit: '' },
      { k: 'maxChars', t: 'range', label: 'Максимум символов в строке', min: 8, max: 60, step: 1, unit: '' },
      { k: 'maxLines', t: 'range', label: 'Максимум строк', min: 1, max: 4, step: 1, unit: '' },
      { k: 'maxDur', t: 'range', label: 'Максимальная длительность', min: 0.5, max: 10, step: 0.1, unit: ' с' },
      { k: 'minDur', t: 'range', label: 'Минимальная длительность', min: 0.2, max: 4, step: 0.05, unit: ' с' },
      { k: 'gapSplit', t: 'range', label: 'Пауза, разрывающая реплику', min: 0.1, max: 2, step: 0.05, unit: ' с' },
      { k: 'splitOnPunct', t: 'bool', label: 'Разрывать по знакам препинания' },
      { k: 'keepPunct', t: 'bool', label: 'Оставлять знаки препинания' },
    ],
  },
  {
    title: '⏱ Синхронизация',
    items: [
      { k: 'offset', t: 'range', label: 'Общий сдвиг таймкодов', min: -3, max: 3, step: 0.01, unit: ' с' },
      { k: 'padStart', t: 'range', label: 'Показывать раньше на', min: 0, max: 1, step: 0.01, unit: ' с' },
      { k: 'padEnd', t: 'range', label: 'Держать дольше на', min: 0, max: 2, step: 0.01, unit: ' с' },
    ],
    note: 'Сдвиг и запасы применяются при пересборке реплик из распознанных слов.',
  },
];

/* ------------------------------------------------------------------ */
/*  Видео и превью                                                     */
/* ------------------------------------------------------------------ */

function loadVideo(file) {
  if (!file) return;
  if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
  state.file = file;
  state.videoUrl = URL.createObjectURL(file);
  video.src = state.videoUrl;
  $('#player').classList.remove('empty');
  $('#drop').classList.add('hide');
  video.addEventListener('loadedmetadata', () => {
    state.videoW = video.videoWidth || 1080;
    state.videoH = video.videoHeight || 1920;
    state.duration = video.duration || 0;
    $('#seek').max = String(state.duration || 0);
    $('#videoInfo').textContent =
      `${file.name} · ${state.videoW}×${state.videoH} · ${fmtTime(state.duration)} · ${(file.size / 1048576).toFixed(1)} МБ`;
    $('#player').style.aspectRatio = `${state.videoW} / ${state.videoH}`;
    fitOverlay();
  }, { once: true });
  toast('Видео загружено');
}

function fitOverlay() {
  const rect = video.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // рисуем ровно по площади самого кадра (object-fit: contain)
  const vw = state.videoW || 1080; const vh = state.videoH || 1920;
  const scale = Math.min(rect.width / vw, rect.height / vh) || 1;
  const w = Math.max(1, Math.round(vw * scale));
  const h = Math.max(1, Math.round(vh * scale));
  overlay.width = Math.round(w * dpr);
  overlay.height = Math.round(h * dpr);
  overlay.style.width = `${w}px`;
  overlay.style.height = `${h}px`;
  overlay.style.left = `${Math.round((rect.width - w) / 2)}px`;
  overlay.style.top = `${Math.round((rect.height - h) / 2)}px`;
  overlay.style.right = 'auto'; overlay.style.bottom = 'auto';
}

function drawGuides(ctx, W, H) {
  ctx.save();
  ctx.strokeStyle = 'rgba(124,108,255,.55)';
  ctx.setLineDash([8, 8]);
  ctx.lineWidth = Math.max(1, W * 0.003);
  ctx.strokeRect(W * 0.06, H * 0.14, W * 0.88, H * 0.72); // безопасная зона сторис
  ctx.restore();
}

function loop() {
  requestAnimationFrame(loop);
  const W = overlay.width; const H = overlay.height;
  if (!W || !H) return;
  octx.clearRect(0, 0, W, H);
  if (showGuides) drawGuides(octx, W, H);
  const t = video.currentTime;
  const cue = cueAt(state.cues, t);
  if (cue) drawCue(octx, cue, t, state.style, W, H);

  // подсветка активной реплики в списке
  const idx = cue ? state.cues.indexOf(cue) : -1;
  if (idx !== lastActive) {
    lastActive = idx;
    $$('.cue').forEach((n, i) => n.classList.toggle('active', i === idx));
  }
  if (!seeking) {
    $('#seek').value = String(t);
    $('#timeLabel').textContent = `${fmtTime(t)} / ${fmtTime(state.duration)}`;
  }
}
let lastActive = -1;
let seeking = false;

/* ------------------------------------------------------------------ */
/*  Реплики                                                            */
/* ------------------------------------------------------------------ */

function rebuildCues() {
  if (!state.words.length) { toast('Сначала распознайте речь или импортируйте субтитры', true); return; }
  const words = applyDictionary(state.words, state.dict);
  state.cues = buildCues(words, state.seg);
  renderCueList();
  toast(`Собрано реплик: ${state.cues.length}`);
}

function renderCueList() {
  const list = $('#cueList');
  list.innerHTML = '';
  $('#cueCount').textContent = state.cues.length ? `${state.cues.length} реплик` : '';
  if (!state.cues.length) {
    list.innerHTML = '<div class="empty-note">Реплик пока нет. Загрузите видео и нажмите «Распознать речь», импортируйте SRT или добавьте реплику вручную.</div>';
    return;
  }
  state.cues.forEach((cue, i) => {
    const node = document.createElement('div');
    node.className = 'cue';
    node.innerHTML = `
      <div class="meta">
        <span class="idx">${i + 1}</span>
        <input class="t" type="number" step="0.01" value="${cue.start.toFixed(2)}" title="Начало, сек">
        <input class="t" type="number" step="0.01" value="${cue.end.toFixed(2)}" title="Конец, сек">
        <span class="tools">
          <button class="mini" data-a="play" title="Проиграть реплику">▶</button>
          <button class="mini" data-a="setStart" title="Начало = текущее время">⇤</button>
          <button class="mini" data-a="setEnd" title="Конец = текущее время">⇥</button>
          <button class="mini" data-a="split" title="Разделить пополам">✂</button>
          <button class="mini" data-a="merge" title="Склеить со следующей">⇓</button>
          <button class="mini danger" data-a="del" title="Удалить">✕</button>
        </span>
      </div>
      <textarea rows="1"></textarea>`;

    const [s, e] = node.querySelectorAll('input.t');
    const ta = node.querySelector('textarea');
    ta.value = cueText(cue);

    s.addEventListener('change', () => { cue.start = +s.value; markManual(); });
    e.addEventListener('change', () => { cue.end = +e.value; markManual(); });
    ta.addEventListener('input', () => { retimeCueText(cue, ta.value); markManual(); });
    node.addEventListener('click', (ev) => {
      if (ev.target.tagName === 'BUTTON') return;
      video.currentTime = cue.start + 0.02;
    });

    node.querySelectorAll('button').forEach((b) => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const a = b.dataset.a;
      if (a === 'play') { video.currentTime = cue.start + 0.01; video.play(); setTimeout(() => video.pause(), (cue.end - cue.start) * 1000); }
      if (a === 'setStart') { cue.start = video.currentTime; markManual(); renderCueList(); }
      if (a === 'setEnd') { cue.end = video.currentTime; markManual(); renderCueList(); }
      if (a === 'split') {
        const parts = splitCue(cue, Math.ceil(cue.words.length / 2));
        if (!parts) { toast('В реплике меньше двух слов', true); return; }
        state.cues.splice(i, 1, parts[0], parts[1]); markManual(); renderCueList();
      }
      if (a === 'merge') {
        if (i >= state.cues.length - 1) { toast('Это последняя реплика', true); return; }
        state.cues.splice(i, 2, mergeCues(cue, state.cues[i + 1])); markManual(); renderCueList();
      }
      if (a === 'del') { state.cues.splice(i, 1); markManual(); renderCueList(); }
    }));

    list.appendChild(node);
  });
}

function markManual() {
  if (autoRebuild) {
    autoRebuild = false;
    $('#autoRebuild').checked = false;
    toast('Ручные правки включены — автопересборка выключена');
  }
}

/* ------------------------------------------------------------------ */
/*  Распознавание                                                      */
/* ------------------------------------------------------------------ */

async function runTranscribe() {
  if (!state.file) { toast('Сначала загрузите видео или аудио', true); return; }
  try {
    progress(true, 'Готовлю звук…', 0.02);
    const words = await transcribe(state.file, state.asr, (msg, p) => progress(true, msg, p));
    state.words = words;
    autoRebuild = true;
    $('#autoRebuild').checked = true;
    const clean = applyDictionary(words, state.dict);
    state.cues = buildCues(clean, state.seg);
    renderCueList();
    progress(false);
    toast(`Распознано слов: ${words.length}, реплик: ${state.cues.length}`);
  } catch (err) {
    progress(false);
    toast(err.message || String(err), true);
  }
}

/* ------------------------------------------------------------------ */
/*  Словарь автозамен                                                  */
/* ------------------------------------------------------------------ */

function renderDict() {
  const box = $('#dictList');
  box.innerHTML = '';
  state.dict.forEach((rule, i) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.style.gap = '6px';
    row.innerHTML = `
      <input type="text" placeholder="было" style="flex:1">
      <input type="text" placeholder="стало" style="flex:1">
      <label class="hint" style="display:flex;align-items:center;gap:4px" title="Трактовать как регулярное выражение">
        <input type="checkbox" style="width:auto"> .*
      </label>
      <button class="mini danger">✕</button>`;
    const [from, to] = row.querySelectorAll('input[type=text]');
    const rx = row.querySelector('input[type=checkbox]');
    from.value = rule.from || '';
    to.value = rule.to || '';
    rx.checked = !!rule.regex;
    from.addEventListener('input', () => { rule.from = from.value; saveSettings(); });
    to.addEventListener('input', () => { rule.to = to.value; saveSettings(); });
    rx.addEventListener('change', () => { rule.regex = rx.checked; saveSettings(); });
    row.querySelector('button').addEventListener('click', () => {
      state.dict.splice(i, 1); saveSettings(); renderDict();
    });
    box.appendChild(row);
  });
}

/* ------------------------------------------------------------------ */
/*  Пресеты                                                            */
/* ------------------------------------------------------------------ */

function refreshPresets() {
  const sel = $('#presetSelect');
  const custom = listPresets();
  sel.innerHTML = '<option value="">— выберите пресет —</option>'
    + `<optgroup label="Готовые">${Object.keys(BUILT_IN_PRESETS).map((n) => `<option value="b:${n}">${n}</option>`).join('')}</optgroup>`
    + (Object.keys(custom).length
      ? `<optgroup label="Мои">${Object.keys(custom).map((n) => `<option value="u:${n}">${n}</option>`).join('')}</optgroup>` : '');
}

/* ------------------------------------------------------------------ */
/*  Экспорт                                                            */
/* ------------------------------------------------------------------ */

function baseName() {
  const n = state.file ? state.file.name.replace(/\.[^.]+$/, '') : 'subtitles';
  return n.replace(/[^\w԰-֏Ѐ-ӿ -]/g, '_');
}

async function runBurn() {
  if (!state.file) { toast('Сначала загрузите видео', true); return; }
  if (!state.cues.length) { toast('Нет ни одной реплики', true); return; }
  if (!canBurn()) { toast('Этот браузер не умеет записывать видео. Используйте Chrome на компьютере или экспорт ASS/SRT.', true); return; }

  const scale = +$('#burnScale').value;
  const width = Math.round((state.videoW * scale) / 2) * 2;
  const height = Math.round((state.videoH * scale) / 2) * 2;
  const fps = +$('#burnFps').value;
  const bitrate = +$('#burnBitrate').value * 1_000_000;

  try {
    progress(true, 'Записываю видео с субтитрами… (идёт в реальном времени)', 0);
    const { blob, ext } = await burnIn({
      video, cues: state.cues, style: state.style, width, height, fps, bitrate,
      onProgress: (p) => progress(true, 'Записываю видео с субтитрами…', p),
    });
    progress(false);
    download(`${baseName()}_subs.${ext}`, blob);
    toast(`Готово: ${(blob.size / 1048576).toFixed(1)} МБ, формат ${ext.toUpperCase()}`);
  } catch (err) {
    progress(false);
    toast(err.message || String(err), true);
  }
}

/* ------------------------------------------------------------------ */
/*  Инициализация                                                      */
/* ------------------------------------------------------------------ */

function bindAsrFields() {
  const a = state.asr;
  const map = [
    ['#asrProvider', 'provider'], ['#elevenKey', 'elevenKey'], ['#openaiKey', 'openaiKey'],
    ['#elevenModel', 'elevenModel'], ['#openaiModel', 'openaiModel'], ['#asrLang', 'language'],
    ['#asrPrompt', 'prompt'], ['#chunkSec', 'chunkSec'],
    ['#endpointEleven', 'endpointEleven'], ['#endpointOpenai', 'endpointOpenai'],
  ];
  map.forEach(([sel, key]) => {
    const node = $(sel);
    if (!node) return;
    node.value = a[key];
    node.addEventListener('input', () => {
      a[key] = node.type === 'number' ? +node.value : node.value;
      saveSettings();
      if (key === 'provider') syncProviderUI();
    });
    node.addEventListener('change', () => {
      a[key] = node.type === 'number' ? +node.value : node.value;
      saveSettings();
      if (key === 'provider') syncProviderUI();
    });
  });
  syncProviderUI();
}

function syncProviderUI() {
  const isEleven = state.asr.provider === 'elevenlabs';
  $('#elevenFields').style.display = isEleven ? '' : 'none';
  $('#openaiFields').style.display = isEleven ? 'none' : '';
}

function ensureFontLoaded() {
  const spec = fontString(state.style, 40);
  if (document.fonts && document.fonts.load) {
    document.fonts.load(spec, 'Բարև привет hello').catch(() => {});
  }
}

function init() {
  loadSettings();

  renderGroups($('#styleControls'), STYLE_SCHEMA, state.style, () => { saveSettings(); ensureFontLoaded(); });
  renderGroups($('#segControls'), SEG_SCHEMA, state.seg, () => {
    saveSettings();
    if (autoRebuild && state.words.length) {
      const words = applyDictionary(state.words, state.dict);
      state.cues = buildCues(words, state.seg);
      renderCueList();
    }
  });
  bindAsrFields();
  renderDict();
  refreshPresets();
  renderCueList();
  ensureFontLoaded();
  loop();

  // --- вкладки ---
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => {
    $$('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    $$('.tabpane').forEach((p) => p.classList.toggle('active', p.id === `pane-${b.dataset.tab}`));
  }));

  // --- загрузка файла ---
  $('#fileInput').addEventListener('change', (e) => loadVideo(e.target.files[0]));
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((ev) => $('#player').addEventListener(ev, (e) => {
    e.preventDefault(); drop.classList.add('hover');
  }));
  ['dragleave', 'drop'].forEach((ev) => $('#player').addEventListener(ev, (e) => {
    e.preventDefault(); drop.classList.remove('hover');
  }));
  $('#player').addEventListener('drop', (e) => {
    const f = e.dataTransfer.files[0];
    if (f) loadVideo(f);
  });
  drop.addEventListener('click', () => $('#fileInput').click());

  // --- свой шрифт ---
  $('#fontFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const face = new FontFace('CustomUploadedFont', await f.arrayBuffer());
      await face.load();
      document.fonts.add(face);
      state.style.fontFamily = 'CustomUploadedFont, "Noto Sans Armenian", sans-serif';
      renderGroups($('#styleControls'), STYLE_SCHEMA, state.style, () => { saveSettings(); ensureFontLoaded(); });
      saveSettings();
      toast(`Шрифт «${f.name}» подключён`);
    } catch (err) {
      toast('Не удалось загрузить шрифт: ' + err.message, true);
    }
  });

  // --- транспорт ---
  $('#playBtn').addEventListener('click', () => (video.paused ? video.play() : video.pause()));
  video.addEventListener('play', () => { $('#playBtn').textContent = '❚❚'; });
  video.addEventListener('pause', () => { $('#playBtn').textContent = '▶'; });
  video.addEventListener('click', () => (video.paused ? video.play() : video.pause()));
  const seek = $('#seek');
  seek.addEventListener('pointerdown', () => { seeking = true; });
  seek.addEventListener('pointerup', () => { seeking = false; });
  seek.addEventListener('input', () => { video.currentTime = +seek.value; });
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); video.paused ? video.play() : video.pause(); }
    if (e.code === 'ArrowLeft') video.currentTime = Math.max(0, video.currentTime - (e.shiftKey ? 1 : 0.1));
    if (e.code === 'ArrowRight') video.currentTime = Math.min(state.duration, video.currentTime + (e.shiftKey ? 1 : 0.1));
  });
  window.addEventListener('resize', fitOverlay);
  new ResizeObserver(fitOverlay).observe($('#player'));

  $('#guides').addEventListener('change', (e) => { showGuides = e.target.checked; });

  // --- распознавание ---
  $('#transcribeBtn').addEventListener('click', runTranscribe);
  $('#rebuildBtn').addEventListener('click', rebuildCues);
  $('#autoRebuild').addEventListener('change', (e) => { autoRebuild = e.target.checked; });
  $('#addDict').addEventListener('click', () => { state.dict.push({ from: '', to: '', regex: false }); renderDict(); });

  $('#importSub').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const cues = parseSubtitleFile(await f.text());
    if (!cues.length) { toast('Не нашёл ни одной реплики в файле', true); return; }
    state.cues = cues;
    state.words = cues.flatMap((c) => c.words);
    autoRebuild = false;
    $('#autoRebuild').checked = false;
    renderCueList();
    toast(`Импортировано реплик: ${cues.length}`);
  });

  $('#addCue').addEventListener('click', () => {
    const t = video.currentTime;
    const cue = { start: t, end: t + 1.5, words: [{ text: 'Նոր տեքստ', start: t, end: t + 1.5 }] };
    const at = state.cues.findIndex((c) => c.start > t);
    if (at === -1) state.cues.push(cue); else state.cues.splice(at, 0, cue);
    markManual();
    renderCueList();
  });

  $('#clearCues').addEventListener('click', () => {
    if (!state.cues.length) return;
    if (!confirm('Удалить все реплики?')) return;
    state.cues = []; renderCueList();
  });

  // --- пресеты ---
  $('#presetSelect').addEventListener('change', (e) => {
    const v = e.target.value;
    if (!v) return;
    const [kind, name] = [v.slice(0, 1), v.slice(2)];
    const preset = kind === 'b' ? BUILT_IN_PRESETS[name] : listPresets()[name];
    if (!preset) return;
    state.style = { ...DEFAULT_STYLE, ...preset };
    renderGroups($('#styleControls'), STYLE_SCHEMA, state.style, () => { saveSettings(); ensureFontLoaded(); });
    saveSettings(); ensureFontLoaded();
    toast(`Пресет «${name}» применён`);
  });
  $('#savePresetBtn').addEventListener('click', () => {
    const name = prompt('Название пресета:');
    if (!name) return;
    savePreset(name, { ...state.style });
    refreshPresets();
    $('#presetSelect').value = `u:${name}`;
    toast('Пресет сохранён');
  });
  $('#delPresetBtn').addEventListener('click', () => {
    const v = $('#presetSelect').value;
    if (!v.startsWith('u:')) { toast('Удалять можно только свои пресеты', true); return; }
    deletePreset(v.slice(2)); refreshPresets(); toast('Пресет удалён');
  });
  $('#resetStyle').addEventListener('click', () => {
    state.style = { ...DEFAULT_STYLE };
    renderGroups($('#styleControls'), STYLE_SCHEMA, state.style, () => { saveSettings(); ensureFontLoaded(); });
    saveSettings(); toast('Стиль сброшен');
  });
  $('#resetSeg').addEventListener('click', () => {
    state.seg = { ...DEFAULT_SEG };
    renderGroups($('#segControls'), SEG_SCHEMA, state.seg, () => saveSettings());
    saveSettings(); rebuildCues();
  });

  // --- экспорт ---
  const needCues = () => {
    if (state.cues.length) return true;
    toast('Нет ни одной реплики', true);
    return false;
  };
  $('#expSrt').addEventListener('click', () => needCues() && download(`${baseName()}.srt`, toSRT(state.cues, state.style, state.seg)));
  $('#expVtt').addEventListener('click', () => needCues() && download(`${baseName()}.vtt`, toVTT(state.cues, state.style, state.seg), 'text/vtt;charset=utf-8'));
  $('#expAss').addEventListener('click', () => needCues() && download(`${baseName()}.ass`, toASS(state.cues, state.style, state.seg, state.videoW, state.videoH)));
  $('#expJson').addEventListener('click', () => needCues() && download(`${baseName()}.json`, toProjectJSON(state), 'application/json'));
  $('#burnBtn').addEventListener('click', runBurn);
  $('#burnInfo').textContent = canBurn()
    ? `Формат записи: ${pickMime().split(';')[0].replace('video/', '').toUpperCase()}`
    : 'Запись видео недоступна в этом браузере — используйте ASS/SRT.';

  $('#importJson').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.style) state.style = { ...DEFAULT_STYLE, ...data.style };
      if (data.seg) state.seg = { ...DEFAULT_SEG, ...data.seg };
      if (Array.isArray(data.dict)) state.dict = data.dict;
      if (Array.isArray(data.words)) state.words = data.words;
      if (Array.isArray(data.cues)) state.cues = data.cues;
      renderGroups($('#styleControls'), STYLE_SCHEMA, state.style, () => { saveSettings(); ensureFontLoaded(); });
      renderGroups($('#segControls'), SEG_SCHEMA, state.seg, () => saveSettings());
      renderDict(); renderCueList(); saveSettings(); ensureFontLoaded();
      toast('Проект загружен');
    } catch (err) { toast('Не смог прочитать файл проекта', true); }
  });

  // --- помощь ---
  $('#helpBtn').addEventListener('click', () => $('#helpDialog').showModal());
  $('#helpClose').addEventListener('click', () => $('#helpDialog').close());

  if (window.Telegram && window.Telegram.WebApp) {
    try { window.Telegram.WebApp.ready(); window.Telegram.WebApp.expand(); } catch (e) { /* вне Telegram */ }
  }
}

document.addEventListener('DOMContentLoaded', init);
