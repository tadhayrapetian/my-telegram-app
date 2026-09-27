/* Этап 6: абонемент считает последний день сам; статусы занятий */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const out = '/tmp/claude-0/-home-user-my-telegram-app/83a4b403-bd6c-579e-8cdd-54291fb0f0f9/scratchpad';
const PORT = 8700 + Math.floor(Math.random() * 200), base = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'crm6-'));
const L = []; let fails = 0;
const ok = (c, n, x) => { L.push((c ? '  ✓ ' : '  ✗ ') + n + (x ? ' — ' + x : '')); if (!c) fails++; };
const api = async (m, u, b) => {
  const r = await fetch(base + u, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
};
let SRV = null;
process.on('exit', () => { try { SRV && SRV.kill('SIGKILL'); } catch (e) {} });
process.on('uncaughtException', e => { console.log(L.join('\n')); console.error('УПАЛО:', e.message); try { SRV.kill('SIGKILL'); } catch (x) {} process.exit(1); });
const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const wd = (iso) => { const x = new Date(iso + 'T00:00:00'); return x.getDay() === 0 ? 7 : x.getDay(); };

(async () => {
  SRV = spawn('python3', ['-m', 'uvicorn', 'app.main:app', '--port', String(PORT), '--host', '127.0.0.1'],
    { cwd: '/home/user/my-telegram-app/teacher-crm', env: { ...process.env, CRM_DATA: DATA }, stdio: ['ignore', 'pipe', 'pipe'] });
  SRV.stderr.on('data', x => { const s = x.toString(); if (/Traceback|Error/.test(s)) process.stderr.write('[py] ' + s); });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 300)); }

  /* --- расчёт последнего дня --- */
  const pv = (await api('POST', '/api/packages/preview',
    { lessons_total: 8, purchased_on: '2026-09-28', weekdays: [1, 3] })).data;   // пн, ср
  ok(pv.count === 8, 'предпросмотр дал 8 дат: ' + pv.count);
  ok(pv.dates[0] === '2026-09-28', 'первая дата — день начала: ' + pv.dates[0]);
  ok(pv.last === '2026-10-21', 'последний день посчитан сам: ' + pv.last);
  ok(pv.dates.every(x => [1, 3].includes(wd(x))), 'все даты попадают в выбранные дни недели');

  const pv2 = (await api('POST', '/api/packages/preview',
    { lessons_total: 12, purchased_on: '2026-09-29', weekdays: [2] })).data;      // только вторник
  ok(pv2.last === '2026-12-15', '12 занятий по вторникам заканчиваются 15.12: ' + pv2.last);

  const pv3 = (await api('POST', '/api/packages/preview',
    { lessons_total: 7, purchased_on: '2026-09-28', weekdays: [] })).data;
  ok(pv3.count === 0 && pv3.last === null, 'без дней недели дат нет — срок задаёт преподаватель');

  /* --- число занятий и дни выбирает преподаватель --- */
  const st = (await api('POST', '/api/students', { name: 'Мари Авагян', level: 'B1' })).data;
  const pk = (await api('POST', '/api/packages', {
    student_id: st.id, lessons_total: 11, purchased_on: d(0), weekdays: [2, 4, 6],
    lesson_time: '18:30', price: 55000, pay_now: true })).data;
  ok(pk.lessons_total === 11, 'абонемент ровно на столько занятий, сколько указал преподаватель: ' + pk.lessons_total);
  ok(pk.weekdays === '2,4,6', 'дни недели сохранены: ' + pk.weekdays);
  ok(pk.lesson_time === '18:30', 'время занятий сохранено: ' + pk.lesson_time);
  ok(pk.expires_on === pk.dates[10], 'дата окончания = день одиннадцатого занятия: ' + pk.expires_on);
  ok(pk.lessons_created === 11, 'занятия сразу встали в расписание: ' + pk.lessons_created);

  const lessons = (await api('GET', `/api/lessons?start=${d(-1)}&end=${d(200)}&student_id=${st.id}`)).data;
  ok(lessons.length === 11, 'в расписании 11 занятий: ' + lessons.length);
  ok(lessons.every(l => l.time === '18:30'), 'все на указанное время');
  ok(lessons.every(l => l.package_id === pk.id), 'все привязаны к абонементу');
  ok(lessons.every(l => [2, 4, 6].includes(wd(l.date))), 'все в выбранные дни недели');
  ok(lessons[lessons.length - 1].date === pk.expires_on, 'последнее занятие совпадает с датой окончания');

  /* --- статусы --- */
  const left = async () => (await api('GET', `/api/packages/${pk.id}`)).data.left;
  await api('POST', `/api/lessons/${lessons[0].id}/status`, { status: 'done' });
  ok(await left() === 10, 'проведённое списалось: ' + await left());

  await api('POST', `/api/lessons/${lessons[1].id}/status`, { status: 'no_show' });
  ok(await left() === 9, 'пропущенное тоже списывается: ' + await left());

  await api('PUT', '/api/settings', { no_show_counts: '0' });
  ok(await left() === 10, 'при выключенной настройке пропуск возвращается в абонемент: ' + await left());
  await api('PUT', '/api/settings', { no_show_counts: '1' });

  await api('POST', `/api/lessons/${lessons[2].id}/status`, { status: 'cancelled' });
  ok(await left() === 9, 'отменённое не списывается: ' + await left());

  /* --- перенос: учителем и учеником --- */
  const byStudent = (await api('POST', `/api/lessons/${lessons[3].id}/move`,
    { date: d(30), time: '19:00', by: 'student', reason: 'Заболел' })).data;
  const oldStudent = (await api('GET', `/api/lessons/${lessons[3].id}`)).data;
  ok(oldStudent.status === 'moved_student', 'перенос учеником помечен отдельно: ' + oldStudent.status);
  ok(oldStudent.moved_by === 'student', 'записано, кто перенёс: ' + oldStudent.moved_by);
  ok(byStudent.status === 'planned' && byStudent.date === d(30), 'новое занятие запланировано на новую дату');
  ok(byStudent.moved_from && byStudent.moved_from.id === lessons[3].id, 'новое ссылается на исходное');

  const byTeacher = (await api('POST', `/api/lessons/${lessons[4].id}/move`,
    { date: d(31), by: 'teacher', reason: 'Своя занятость' })).data;
  const oldTeacher = (await api('GET', `/api/lessons/${lessons[4].id}`)).data;
  ok(oldTeacher.status === 'moved_teacher', 'перенос учителем помечен отдельно: ' + oldTeacher.status);
  ok(byTeacher.moved_from.moved_by === 'teacher', 'в цепочке видно, что перенёс учитель');
  ok(await left() === 9, 'перенос ничего не списывает: ' + await left());

  const bad = await api('POST', `/api/lessons/${lessons[5].id}/status`, { status: 'выдумка' });
  ok(bad.status === 400, 'неизвестный статус не принимается: ' + bad.status);

  /* --- интерфейс --- */
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 980 }, deviceScaleFactor: 1.5, locale: 'ru-RU' });
  const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('dialog', x => x.accept());
  await p.goto(base + '/');
  await p.waitForTimeout(800);
  await p.click('[data-tab="students"]');
  await p.waitForTimeout(500);
  await p.click(`[data-open-student="${st.id}"]`);
  await p.waitForTimeout(600);

  await p.click('[data-act="package-new"]');
  await p.waitForTimeout(400);
  await p.fill('#pk-total', '10');
  await p.click('[data-day="1"]');
  await p.click('[data-day="5"]');
  await p.fill('#pk-time', '16:00');
  await p.fill('#pk-price', '50000');
  await p.waitForTimeout(250);
  const calc = await p.locator('#pk-calc').innerText();
  ok(/Последнее занятие: \d{1,2} [а-я]+/.test(calc), 'форма сразу показывает последний день: ' + calc.split('\n')[0]);
  ok(calc.includes('пн, пт') && /первое \d/.test(calc), 'форма перечисляет дни и первое занятие: ' + calc.split('\n')[1]);
  await p.screenshot({ path: out + '/shots/crm-package-form.png' });

  await p.click('[data-act="submit"]');
  await p.waitForTimeout(1000);
  const packs = (await api('GET', `/api/packages?student_id=${st.id}`)).data;
  const fresh = packs.find(x => x.lessons_total === 10);
  ok(!!fresh, 'абонемент на 10 занятий создан из интерфейса');
  ok(fresh && fresh.weekdays === '1,5', 'дни из интерфейса сохранились: ' + (fresh && fresh.weekdays));
  const preview = (await api('POST', '/api/packages/preview',
    { lessons_total: 10, purchased_on: fresh.purchased_on, weekdays: [1, 5] })).data;
  ok(fresh.expires_on === preview.last, 'последний день из интерфейса совпал с расчётом: ' + fresh.expires_on);

  // статусы в календаре: карточка ученика открыта поверх — закрываем
  await p.click('.modal [data-act="close"]');
  await p.waitForTimeout(400);
  await p.click('[data-tab="calendar"]');
  await p.waitForTimeout(600);
  await p.click('[data-act="cal-mode"][data-mode="month"]');
  await p.waitForTimeout(700);
  // занятия абонемента расходятся на два месяца — считаем в обоих
  const marks = { no_show: 0, moved_student: 0, moved_teacher: 0, cancelled: 0 };
  for (let month = 0; month < 2; month++) {
    for (const k of Object.keys(marks)) marks[k] += await p.locator('.lsn.' + k).count();
    if (month === 0) { await p.click('[data-act="cal-next"]'); await p.waitForTimeout(700); }
  }
  ok(marks.no_show >= 1, 'пропущенное занятие видно в календаре отдельным цветом: ' + marks.no_show);
  ok(marks.moved_student >= 1, 'перенос учеником видно в календаре: ' + marks.moved_student);
  ok(marks.moved_teacher >= 1, 'перенос учителем видно в календаре: ' + marks.moved_teacher);
  ok(marks.cancelled >= 1, 'отменённое видно в календаре: ' + marks.cancelled);
  const firstMoved = p.locator('.lsn.moved_student').first();   // сейчас открыт октябрь
  const tip = await firstMoved.getAttribute('title');
  ok((tip || '').includes('перенесено учеником'), 'подсказка на занятии называет статус: ' + tip);
  await p.screenshot({ path: out + '/shots/crm-month-statuses.png' });

  // в недельном виде статус написан словами
  await p.click('[data-act="cal-mode"][data-mode="week"]');
  await p.waitForTimeout(600);
  for (let i = 0; i < 6 && await p.locator('.lsn.moved_student').count() === 0; i++) {
    await p.click('[data-act="cal-next"]'); await p.waitForTimeout(450);
  }
  const wkMoved = p.locator('.lsn.moved_student').first();
  ok((await wkMoved.innerText()).includes('перенос (ученик)'), 'в неделе на плашке написано, кто перенёс: ' +
     (await wkMoved.innerText()).replace(/\n/g, ' '));
  await p.screenshot({ path: out + '/shots/crm-week-statuses.png' });

  await p.click('[data-tab="settings"]');
  await p.waitForTimeout(500);
  ok(await p.locator('#se-noshow').count() === 1, 'в настройках есть переключатель списания пропусков');
  await p.screenshot({ path: out + '/shots/crm-settings.png' });

  console.log(L.join('\n'));
  console.log('ОШИБКИ JS: ' + (errs.length ? errs.join('\n') : 'нет'));
  console.log(fails ? `ПРОВАЛЕНО: ${fails}` : 'Этап 6 — все проверки пройдены');
  await b.close(); SRV.kill();
  process.exit(fails || errs.length ? 1 : 0);
})();
