/* Этап 5: кабинет ученика, переписка, фото — в Python-версии */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const out = '/tmp/claude-0/-home-user-my-telegram-app/83a4b403-bd6c-579e-8cdd-54291fb0f0f9/scratchpad';
const PORT = 9300 + Math.floor(Math.random() * 90), base = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'crm5-'));
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
const png = path.join(DATA, 'me.png');
fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAHUlEQVRYhe3OMQEAAAgDoK1/aM3g4QcJqCQ5uQMAAL4NLQwCAV0BLpsAAAAASUVORK5CYII=', 'base64'));

(async () => {
  SRV = spawn('python3', ['-m', 'uvicorn', 'app.main:app', '--port', String(PORT), '--host', '127.0.0.1'],
    { cwd: '/home/user/my-telegram-app/teacher-crm', env: { ...process.env, CRM_DATA: DATA }, stdio: ['ignore', 'pipe', 'pipe'] });
  SRV.stderr.on('data', x => { const s = x.toString(); if (/Traceback/.test(s)) process.stderr.write('[py] ' + s); });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 300)); }

  await api('PUT', '/api/settings', { teacher_name: 'Тадевос' });
  const st = (await api('POST', '/api/students', { name: 'Ани Саркисян', level: 'B2' })).data;
  await api('POST', '/api/packages', { student_id: st.id, lessons_total: 8, purchased_on: d(-7), expires_on: d(30), price: 48000, pay_now: true });
  await api('POST', '/api/lessons', { student_id: st.id, date: d(2), time: '17:00', topic: 'Present Perfect', homework: 'Unit 5, упр. 3–5' });

  // ссылка и код
  const link = (await api('GET', `/api/students/${st.id}/portal`)).data;
  ok(link.path.startsWith('/s/') && /^\d{4}$/.test(link.code), 'ссылка и код кабинета выданы: ' + link.code);

  // сообщение преподавателя
  await api('POST', `/api/students/${st.id}/messages`, { text: 'Ани, домашку до вторника' });
  const msgs = (await api('GET', `/api/students/${st.id}/messages`)).data;
  ok(msgs.length === 1 && msgs[0].author === 'teacher', 'сообщение преподавателя записано');

  // --- кабинет ученика в браузере (телефон)
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ru-RU' });
  const sp = await ctx.newPage();
  const errs = []; sp.on('pageerror', e => errs.push(String(e))); sp.on('dialog', x => x.accept());
  await sp.goto(base + link.path);
  await sp.waitForTimeout(600);
  ok(await sp.locator('#code').count() === 1, 'кабинет просит код');
  await sp.fill('#code', '0000');
  await sp.click('#go');
  await sp.waitForTimeout(600);
  ok(await sp.locator('#code').count() === 1, 'неверный код не пускает');
  await sp.fill('#code', link.code);
  await sp.click('#go');
  await sp.waitForTimeout(800);
  const cab = await sp.locator('#pview').innerText();
  ok(cab.includes('Ани Саркисян'), 'кабинет открылся');
  ok(cab.includes('Present Perfect') || cab.includes('Unit 5'), 'ученик видит ближайшее занятие и домашку');
  ok(cab.includes('Ани, домашку до вторника'), 'ученик видит сообщение преподавателя');
  ok(cab.includes('8') && cab.includes('Осталось занятий'), 'остаток абонемента показан');

  // ответ ученика
  await sp.fill('#m-text', 'Спасибо, сделаю!');
  await sp.click('#m-send');
  await sp.waitForTimeout(900);
  ok((await sp.locator('.chat .msg').count()) === 2, 'ответ ученика в переписке');

  // фото
  await sp.evaluate(() => { pendingPick = 'photo'; });
  await sp.setInputFiles('#pfile', png);
  await sp.waitForTimeout(1500);
  ok(await sp.locator('.ava-img').count() === 1, 'фото ученика загружено и показано');
  await sp.screenshot({ path: out + '/new-portal.png', fullPage: true });

  // повторный вход без кода
  await sp.reload();
  await sp.waitForTimeout(900);
  ok(await sp.locator('#code').count() === 0, 'кабинет помнит вход, код не спрашивает');

  // --- сторона преподавателя
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1.5, locale: 'ru-RU' });
  p.on('pageerror', e => errs.push(String(e))); p.on('dialog', x => x.accept());
  await p.goto(base + '/');
  await p.waitForTimeout(800);
  await p.click('[data-tab="students"]');
  await p.waitForTimeout(500);
  await p.click('.row[data-open-student]');
  await p.waitForTimeout(900);
  const card = await p.locator('.modal-b').innerText();
  ok(card.includes('Переписка с учеником'), 'у преподавателя есть переписка');
  ok(card.includes('Спасибо, сделаю!'), 'преподаватель видит ответ ученика');
  ok(await p.locator('.modal-b img[src^="/api/materials/"]').count() === 1, 'фото ученика видно в карточке');
  await p.screenshot({ path: out + '/new-card-chat.png' });

  // кнопка «Кабинет ученика»
  await p.click('.modal [data-act="portal-share"]');
  await p.waitForTimeout(600);
  ok((await p.inputValue('#pl-code')) === link.code, 'кнопка показывает тот же код');
  await p.screenshot({ path: out + '/new-portal-share.png' });

  // отправка сообщения из карточки
  await p.keyboard.press('Escape');
  await p.click('.row[data-open-student]');
  await p.waitForTimeout(800);
  await p.fill('#ch-text', 'Отлично, жду');
  await p.click('[data-act="chat-send"]');
  await p.waitForTimeout(1000);
  const after = (await api('GET', `/api/students/${st.id}/messages`)).data;
  ok(after.length === 3, 'сообщение из карточки отправлено: ' + after.length);

  console.log(L.join('\n'));
  console.log('ОШИБКИ JS: ' + (errs.length ? errs.join('\n') : 'нет'));
  console.log(fails ? `ПРОВАЛЕНО: ${fails}` : 'Этап 5 — все проверки пройдены');
  await b.close(); SRV.kill();
  process.exit(fails || errs.length ? 1 : 0);
})();
