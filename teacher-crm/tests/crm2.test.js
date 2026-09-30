/* Этап 2: абонементы, списание, отмена, перенос */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const out = '/tmp/claude-0/-home-user-my-telegram-app/83a4b403-bd6c-579e-8cdd-54291fb0f0f9/scratchpad';
const PORT = 8500 + Math.floor(Math.random() * 200), base = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'crm2-'));
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

(async () => {
  SRV = spawn('python3', ['-m', 'uvicorn', 'app.main:app', '--port', String(PORT), '--host', '127.0.0.1'],
    { cwd: '/home/user/my-telegram-app/teacher-crm', env: { ...process.env, CRM_DATA: DATA }, stdio: ['ignore', 'pipe', 'pipe'] });
  SRV.stderr.on('data', x => { const s = x.toString(); if (/Traceback|Error/.test(s)) process.stderr.write('[py] ' + s); });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 300)); }

  // ученик + абонемент на 8 занятий
  const st = (await api('POST', '/api/students', { name: 'Ани Саркисян', level: 'B2' })).data;
  const pk = (await api('POST', '/api/packages', {
    student_id: st.id, lessons_total: 8, purchased_on: d(-20), expires_on: d(20), price: 48000, pay_now: true })).data;
  ok(pk.left === 8 && pk.status === 'active', 'абонемент создан: осталось ' + pk.left);

  // занятия: 4 в прошлом
  for (let i = 1; i <= 4; i++) await api('POST', '/api/lessons', { student_id: st.id, date: d(-i * 3), time: '17:00', topic: 'Урок ' + i });
  const unmarked = (await api('GET', '/api/lessons/unmarked')).data;
  ok(unmarked.length === 4, 'прошедшие занятия ждут отметки: ' + unmarked.length);
  ok(unmarked.every(l => l.package_id === pk.id), 'занятия привязались к абонементу');

  // отмечаем три проведёнными — списываются
  for (const l of unmarked.slice(0, 3)) await api('POST', `/api/lessons/${l.id}/status`, { status: 'done' });
  let card = (await api('GET', `/api/students/${st.id}`)).data;
  ok(card.lessons_left === 5, 'после трёх проведённых осталось 5: ' + card.lessons_left);

  // отмена возвращает занятие
  await api('POST', `/api/lessons/${unmarked[0].id}/status`, { status: 'cancelled' });
  card = (await api('GET', `/api/students/${st.id}`)).data;
  ok(card.lessons_left === 6, 'отмена вернула занятие в абонемент: ' + card.lessons_left);

  // перенос сохраняет историю
  const moved = (await api('POST', `/api/lessons/${unmarked[3].id}/move`, { date: d(3), time: '19:00', reason: 'Ученик заболел' })).data;
  ok(moved.moved_from && moved.moved_from.id === unmarked[3].id, 'новое занятие ссылается на исходное');
  ok(moved.move_reason === 'Ученик заболел', 'причина переноса сохранена');
  const oldLesson = (await api('GET', `/api/lessons/${unmarked[3].id}`)).data;
  ok(oldLesson.status === 'moved_teacher', 'исходное занятие помечено перенесённым учителем: ' + oldLesson.status);
  ok(oldLesson.moved_to && oldLesson.moved_to.id === moved.id, 'у исходного видно, куда перенесли');
  card = (await api('GET', `/api/students/${st.id}`)).data;
  ok(card.lessons_left === 6, 'перенос не списывает занятие: ' + card.lessons_left);

  // предупреждения: отдельный ученик с абонементом на исходе
  const st3 = (await api('POST', '/api/students', { name: 'Мария' })).data;
  const small = (await api('POST', '/api/packages', {
    student_id: st3.id, lessons_total: 3, purchased_on: d(-10), expires_on: d(30), price: 9000 })).data;
  for (let i = 1; i <= 2; i++) {
    const created = (await api('POST', '/api/lessons', { student_id: st3.id, date: d(-i), time: '15:00' })).data;
    await api('POST', `/api/lessons/${created.ids[0]}/status`, { status: 'done' });
  }
  const warn = (await api('GET', '/api/packages/warnings')).data;
  const mine = warn.filter(w => w.student_id === st3.id);
  ok(mine.length === 1 && mine[0].left === 1, 'абонемент на исходе попал в предупреждения: осталось ' + (mine[0] && mine[0].left));

  // предупреждение по сроку окончания
  const st4 = (await api('POST', '/api/students', { name: 'Давид' })).data;
  await api('POST', '/api/packages', { student_id: st4.id, lessons_total: 10, purchased_on: d(-10), expires_on: d(3), price: 30000 });
  const warn2 = (await api('GET', '/api/packages/warnings')).data.filter(w => w.student_id === st4.id);
  ok(warn2.length === 1 && warn2[0].days_left <= 7, 'скорое окончание срока тоже предупреждает: дней ' + (warn2[0] && warn2[0].days_left));

  // просроченный абонемент
  const st2 = (await api('POST', '/api/students', { name: 'Тигран' })).data;
  const old = (await api('POST', '/api/packages', { student_id: st2.id, lessons_total: 4, purchased_on: d(-90), expires_on: d(-5), price: 10000 })).data;
  ok(old.status === 'expired', 'просроченный абонемент получил статус expired');

  // --- интерфейс
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 950 }, deviceScaleFactor: 1.5, locale: 'ru-RU' });
  const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('dialog', x => x.accept());
  await p.goto(base + '/');
  await p.waitForTimeout(800);
  await p.click('[data-tab="students"]');
  await p.waitForTimeout(500);
  await p.click(`[data-open-student="${st.id}"]`);
  await p.waitForTimeout(600);
  const cardText = await p.locator('.modal-b').innerText();
  ok(cardText.includes('Абонементы'), 'в карточке есть раздел абонементов');
  ok(cardText.includes('8 занятий'), 'абонемент показан с количеством');
  await p.screenshot({ path: out + '/crm-packages.png' });

  // покупка абонемента через интерфейс
  await p.click('[data-act="package-new"]');
  await p.waitForTimeout(400);
  await p.fill('#pk-total', '10');
  await p.fill('#pk-price', '60000');
  await p.click('[data-act="submit"]');
  await p.waitForTimeout(900);
  const after = (await api('GET', `/api/packages?student_id=${st.id}`)).data;
  ok(after.length === 2, 'второй абонемент куплен через интерфейс: ' + after.length);
  ok(after[0].left === 10, 'новый абонемент полный: ' + after[0].left);

  console.log(L.join('\n'));
  console.log('ОШИБКИ JS: ' + (errs.length ? errs.join('\n') : 'нет'));
  console.log(fails ? `ПРОВАЛЕНО: ${fails}` : 'Этап 2 — все проверки пройдены');
  await b.close(); SRV.kill();
  process.exit(fails || errs.length ? 1 : 0);
})();
