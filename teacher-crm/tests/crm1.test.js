/* Этап 1: ученики и календарь */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const out = '/tmp/claude-0/-home-user-my-telegram-app/83a4b403-bd6c-579e-8cdd-54291fb0f0f9/scratchpad';
const PORT = 8300 + Math.floor(Math.random() * 200), base = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-'));
const L = []; let fails = 0;
const ok = (c, n, x) => { L.push((c ? '  ✓ ' : '  ✗ ') + n + (x ? ' — ' + x : '')); if (!c) fails++; };
let SRV = null;
process.on('exit', () => { try { SRV && SRV.kill('SIGKILL'); } catch (e) {} });
process.on('uncaughtException', e => { console.log(L.join('\n')); console.error('УПАЛО:', e.message); try { SRV.kill('SIGKILL'); } catch (x) {} process.exit(1); });

(async () => {
  SRV = spawn(process.execPath === 'node' ? 'python3' : 'python3',
    ['-m', 'uvicorn', 'app.main:app', '--port', String(PORT), '--host', '127.0.0.1'],
    { cwd: '/home/user/my-telegram-app/teacher-crm', env: { ...process.env, CRM_DATA: DATA }, stdio: ['ignore', 'pipe', 'pipe'] });
  SRV.stderr.on('data', d => { const s = d.toString(); if (/error|Error|Traceback/.test(s)) process.stderr.write('[py] ' + s); });
  // ждём готовности
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(base + '/api/health'); if (r.ok) break; } catch (e) {}
    await new Promise(r => setTimeout(r, 300));
  }
  ok((await (await fetch(base + '/api/health')).json()).ok === true, 'сервер отвечает');

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 950 }, deviceScaleFactor: 1.5, locale: 'ru-RU' });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  p.on('dialog', d => d.accept());
  await p.goto(base + '/');
  await p.waitForTimeout(800);
  ok((await p.locator('.top h1').innerText()) === 'Сводка', 'программа открывается на сводке');
  await p.click('[data-tab="students"]');
  await p.waitForTimeout(500);
  ok((await p.locator('.top h1').innerText()) === 'Ученики', 'раздел учеников открывается');

  // добавляем ученика
  await p.click('[data-act="student-new"]');
  await p.fill('#st-name', 'Анна Петросян');
  await p.fill('#st-level', 'B1');
  await p.fill('#st-schedule', 'Пн и Чт, 18:00');
  await p.fill('#st-goals', 'Подготовка к IELTS');
  await p.click('[data-act="submit"]');
  await p.waitForTimeout(600);
  ok((await p.locator('.row .nm').first().innerText()) === 'Анна Петросян', 'ученик появился в списке');

  // поиск
  await p.fill('#stSearch', 'ielts');
  await p.waitForTimeout(600);
  ok(await p.locator('.row[data-open-student]').count() === 1, 'поиск по целям находит ученика');
  await p.fill('#stSearch', 'зззз');
  await p.waitForTimeout(600);
  ok(await p.locator('.row[data-open-student]').count() === 0, 'поиск по несуществующему пуст');
  await p.fill('#stSearch', '');
  await p.waitForTimeout(600);

  // занятие на сегодня
  await p.click('[data-tab="calendar"]');
  await p.waitForTimeout(500);
  ok(await p.locator('.week .day').count() === 7, 'недельный календарь показывает 7 дней');
  await p.click('.top-act [data-act="lesson-new"]');
  await p.waitForTimeout(400);
  await p.fill('#ls-topic', 'Present Perfect');
  await p.fill('#ls-repeat', '2');
  await p.click('[data-act="submit"]');
  await p.waitForTimeout(800);
  const created = await (await fetch(base + '/api/lessons?start=2020-01-01&end=2030-01-01')).json();
  ok(created.length === 3, 'создано 3 занятия с повтором: ' + created.length);
  ok(await p.locator('.week .lsn').count() >= 1, 'занятие видно в календаре');
  await p.screenshot({ path: out + '/crm-week.png' });

  // месяц
  await p.click('[data-act="cal-mode"][data-mode="month"]');
  await p.waitForTimeout(500);
  ok(await p.locator('.mc').count() >= 28, 'месячная сетка построена');
  const inMonth = await p.locator('.mc .lsn').count();
  ok(inMonth >= 1, 'занятия видны в месяце: ' + inMonth + ' (остальные — в следующем месяце)');
  await p.screenshot({ path: out + '/crm-month.png' });

  // листание
  const t1 = await p.locator('.cal-title').innerText();
  await p.click('[data-act="cal-next"]');
  await p.waitForTimeout(400);
  ok(t1 !== (await p.locator('.cal-title').innerText()), 'месяц листается');
  await p.click('[data-act="cal-today"]');
  await p.waitForTimeout(400);

  // карточка занятия и статус
  await p.click('[data-act="cal-mode"][data-mode="week"]');
  await p.waitForTimeout(400);
  await p.click('.week .lsn');
  await p.waitForTimeout(500);
  ok(await p.locator('#ls-topic').inputValue() === 'Present Perfect', 'карточка занятия открылась');
  await p.click('[data-act="lesson-status"][data-status="done"]');
  await p.waitForTimeout(700);
  ok(await p.locator('.week .lsn.done').count() === 1, 'занятие отмечено проведённым');

  // карточка ученика
  await p.click('[data-tab="students"]');
  await p.waitForTimeout(500);
  await p.click('.row[data-open-student]');
  await p.waitForTimeout(600);
  const card = await p.locator('.modal-b').innerText();
  ok(card.includes('Анна Петросян') || (await p.locator('.modal-h h3').innerText()) === 'Анна Петросян', 'карточка ученика открылась');
  ok(card.includes('Present Perfect'), 'в журнале ученика видно занятие');
  await p.screenshot({ path: out + '/crm-student.png' });

  console.log(L.join('\n'));
  console.log('ОШИБКИ JS: ' + (errs.length ? errs.join('\n') : 'нет'));
  console.log(fails ? `ПРОВАЛЕНО: ${fails}` : 'Этап 1 — все проверки пройдены');
  await b.close(); SRV.kill();
  process.exit(fails || errs.length ? 1 : 0);
})();
