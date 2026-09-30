/* Календарь в обе стороны: подписка на занятия Slate и чужой календарь внутри */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const out = process.env.SHOTS || '/tmp/slate-shots';
const PORT = 5500 + Math.floor(Math.random() * 200), base = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-cal-'));
const L = []; let fails = 0;
const ok = (c, n, x) => { L.push((c ? '  ✓ ' : '  ✗ ') + n + (x ? ' — ' + x : '')); if (!c) fails++; };
let SRV = null, ICAL = null;
process.on('exit', () => { try { SRV && SRV.kill('SIGKILL'); } catch (e) {} });
process.on('uncaughtException', e => { console.log(L.join('\n')); console.error('УПАЛО:', e.message); try { SRV.kill('SIGKILL'); } catch (x) {} process.exit(1); });

const day = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const stamp = (n, hh) => day(n).replace(/-/g, '') + 'T' + String(hh).padStart(2, '0') + '0000';

/* чужой календарь: отдаёт два события — сегодня и завтра */
let calBody = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Личное',
  'BEGIN:VEVENT', 'UID:doc-1', 'SUMMARY:Врач', `DTSTART:${stamp(0, 9)}`, `DTEND:${stamp(0, 10)}`, 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:trip', 'SUMMARY:Поездка\\, важная', `DTSTART;VALUE=DATE:${day(1).replace(/-/g, '')}`, 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');
let calStatus = 200, calType = 'text/calendar';

(async () => {
  fs.mkdirSync(out, { recursive: true });
  ICAL = http.createServer((req, res) => {
    res.writeHead(calStatus, { 'content-type': calType });
    res.end(calStatus === 200 ? calBody : 'нет такого календаря');
  });
  const icalPort = await new Promise(r => ICAL.listen(0, '127.0.0.1', () => r(ICAL.address().port)));
  const feedUrl = `http://127.0.0.1:${icalPort}/personal.ics`;

  SRV = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), SLATE_DATA: DATA }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/me')).status) break; } catch (e) {} await new Promise(r => setTimeout(r, 250)); }

  let cookie = '';
  const api = async (m, u, b) => {
    const r = await fetch(base + u, { method: m, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: b ? JSON.stringify(b) : undefined });
    const set = r.headers.get('set-cookie');
    if (set && /sid=/.test(set)) cookie = set.split(';')[0];
    return { status: r.status, data: await r.json().catch(() => null) };
  };

  const reg = await api('POST', '/api/auth/request', { email: 'anna@mail.com', mode: 'signup', name: 'Анна' });
  await api('POST', '/api/auth/verify', { email: 'anna@mail.com', code: reg.data.devCode });
  await api('PUT', '/api/state', { version: 0, doc: {
    v: 2, lang: 'ru', cur: 'AMD', teacher: 'Анна',
    students: [{ id: 's1', name: 'Мари Авагян', subject: 'Английский', level: 'B1', code: '1234' }],
    lessons: [
      { id: 'l1', studentId: 's1', date: day(1), time: '17:00', dur: 90, status: 'planned', hw: 'Unit 5', online: true, link: 'https://meet.example/x' },
      { id: 'l2', studentId: 's1', date: day(2), time: '18:00', dur: 60, status: 'cancelled' },
      { id: 'l3', studentId: 's1', date: day(-3), time: '15:00', dur: 60, status: 'done' },
      { id: 'l4', studentId: 's1', date: day(400), time: '15:00', dur: 60, status: 'planned' },
    ], payments: [], packs: [] } });

  /* --- наружу: подписка на занятия --- */
  const cal = await api('GET', '/api/calendar');
  ok(cal.status === 200 && /\/ics\/[A-Za-z0-9_-]+\.ics$/.test(cal.data.url), 'ссылка для подписки выдана: ' + cal.data.url);
  const icsPath = cal.data.url.replace(/^https?:\/\/[^/]+/, '');

  const r = await fetch(base + icsPath);
  const text = await r.text();
  ok(r.headers.get('content-type').includes('text/calendar'), 'отдаётся как календарь: ' + r.headers.get('content-type'));
  ok(text.startsWith('BEGIN:VCALENDAR'), 'формат правильный');
  ok(/\r\n/.test(text), 'переводы строк по стандарту');
  const events = text.split('BEGIN:VEVENT').length - 1;
  ok(events === 2, 'в календаре только состоявшиеся и будущие занятия: ' + events);
  ok(/SUMMARY:Мари Авагян · Английский/.test(text), 'в названии ученик и предмет');
  ok(/DTSTART:\d{8}T170000/.test(text), 'время занятия на месте');
  ok(/DTEND:\d{8}T183000/.test(text), 'полтора часа посчитаны: ' + (text.match(/DTEND:\d+T\d+/) || [])[0]);
  ok(/DESCRIPTION:.*Unit 5/.test(text), 'домашнее задание попало в описание');
  ok(/URL:https:\/\/meet.example\/x/.test(text), 'ссылка на онлайн-занятие приложена');
  ok(!/l2@slate/.test(text), 'отменённое занятие не показывается');
  ok(!/l4@slate/.test(text), 'слишком далёкое занятие не показывается');
  ok(/X-WR-CALNAME:Slate — Анна/.test(text), 'календарь подписан именем: ' + (text.match(/X-WR-CALNAME:.*/) || [])[0]);

  const changed = await api('POST', '/api/calendar/reset');
  ok(changed.status === 200 && changed.data.url !== cal.data.url, 'ссылку можно сменить');
  ok((await fetch(base + icsPath)).status === 404, 'старая ссылка перестала работать');
  ok((await fetch(base + changed.data.url.replace(/^https?:\/\/[^/]+/, ''))).status === 200, 'новая работает');
  ok((await fetch(base + '/ics/выдумка.ics')).status === 404, 'чужая ссылка ничего не отдаёт');

  /* --- внутрь: чужой календарь --- */
  const bad = await api('POST', '/api/calendar/feed', { url: 'ftp://nope' });
  ok(bad.status === 400, 'не-ссылку не принимаем: ' + bad.status);

  calStatus = 404;
  const missing = await api('POST', '/api/calendar/feed', { url: feedUrl });
  ok(missing.status === 502, 'недоступный календарь — понятная ошибка: ' + missing.status);
  calStatus = 200;

  const feed = await api('POST', '/api/calendar/feed', { url: feedUrl });
  ok(feed.status === 200 && feed.data.feed.events === 2, 'календарь подключён, событий: ' +
     (feed.data.feed && feed.data.feed.events));
  ok(feed.data.feed.name === 'Личное', 'имя календаря прочитано: ' + feed.data.feed.name);

  const state = await api('GET', '/api/state');
  ok(state.data.busy && state.data.busy.events.length === 2, 'события приходят вместе с данными');
  const doc = state.data.busy.events.find(e => e.title === 'Врач');
  ok(!!doc, 'событие «Врач» на месте');
  ok(new Date(doc.start).getHours() === 9, 'время события местное: ' + new Date(doc.start).getHours());
  const trip = state.data.busy.events.find(e => /Поездка/.test(e.title));
  ok(trip && trip.allDay === true, 'событие на весь день помечено');
  ok(trip && trip.title === 'Поездка, важная', 'экранированная запятая разобрана: ' + (trip && trip.title));

  /* webcal:// тоже принимаем */
  const webcal = await api('POST', '/api/calendar/feed', { url: feedUrl.replace('http://', 'webcal://') });
  ok(webcal.status === 502 || webcal.status === 200, 'webcal-ссылка не ломает обработчик: ' + webcal.status);
  await api('POST', '/api/calendar/feed', { url: feedUrl });

  /* --- интерфейс --- */
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1340, height: 950 }, deviceScaleFactor: 1.5 });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(base + '/app');
  await p.waitForTimeout(900);
  await p.fill('#au-email', 'anna@mail.com');
  await p.click('[data-act="au-send"]'); await p.waitForTimeout(700);
  const code = ((await p.locator('.banner').innerText()).match(/\d{6}/) || [''])[0];
  await p.fill('#au-code', code); await p.click('[data-act="au-verify"]'); await p.waitForTimeout(1700);
  await p.locator('[data-lang="ru"]').last().click().catch(() => {});
  await p.waitForTimeout(400);

  await p.click('[data-tab="week"]'); await p.waitForTimeout(700);
  ok(await p.locator('.lsn.busy').count() >= 1, 'личные дела видны в расписании: ' + await p.locator('.lsn.busy').count());
  ok((await p.locator('.lsn.busy').first().innerText()).includes('Врач'), 'с названием события');
  await p.screenshot({ path: out + '/slate-calendar-week.png' });

  await p.click('[data-tab="settings"]'); await p.waitForTimeout(700);
  const link = await p.locator('#cal-url').inputValue();
  ok(/\/ics\//.test(link), 'в настройках есть ссылка для подписки: ' + link);
  ok((await p.locator('#cal-feed').inputValue()).includes('personal.ics'), 'и подключённый календарь');
  await p.screenshot({ path: out + '/slate-calendar-settings.png' });

  await p.click('[data-act="cal-feed-off"]'); await p.waitForTimeout(1200);
  const after = await api('GET', '/api/calendar');
  ok(after.data.feed === null, 'календарь отключается кнопкой');
  ok(errs.length === 0, 'без ошибок JS', errs[0]);

  await b.close(); SRV.kill(); ICAL.close();
  console.log(L.join('\n'));
  console.log(fails ? `\nПРОВАЛОВ: ${fails}` : `\nВСЁ ЗЕЛЁНОЕ (${L.length} проверок)`);
  process.exit(fails ? 1 : 0);
})();
