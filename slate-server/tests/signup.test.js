/* Регистрация преподавателя, вход и кабинет ученика на сервере */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const out = '/tmp/slate-shots';
const PORT = 3400 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-'));
const L = []; let fails = 0;
const ok = (c, n, x) => { L.push((c ? '  ✓ ' : '  ✗ ') + n + (x ? ' — ' + x : '')); if (!c) fails++; };
const api = async (m, u, b) => {
  const r = await fetch(base + u, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
};
let SRV = null;
process.on('exit', () => { try { SRV && SRV.kill('SIGKILL'); } catch (e) {} });
process.on('uncaughtException', e => { console.log(L.join('\n')); console.error('УПАЛО:', e.message); try { SRV.kill('SIGKILL'); } catch (x) {} process.exit(1); });

(async () => {
  SRV = spawn(process.execPath, ['server.js'], {
    cwd: '/home/user/my-telegram-app/slate-server',
    env: { ...process.env, PORT: String(PORT), SLATE_DATA: DATA }, stdio: ['ignore', 'pipe', 'pipe'] });
  SRV.stderr.on('data', x => process.stderr.write('[srv] ' + x));
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/me')).status) break; } catch (e) {} await new Promise(r => setTimeout(r, 300)); }

  /* --- сервер: регистрация отделена от входа --- */
  const noAcc = await api('POST', '/api/auth/request', { email: 'ghost@mail.com' });
  ok(noAcc.status === 404 && noAcc.data.error === 'no_account', 'вход с незнакомым адресом не заводит аккаунт молча: ' + noAcc.status);

  const noName = await api('POST', '/api/auth/request', { email: 'anna@mail.com', mode: 'signup', name: '' });
  ok(noName.status === 400 && noName.data.error === 'bad_name', 'регистрация без имени не проходит: ' + noName.status);

  const reg = await api('POST', '/api/auth/request', { email: 'anna@mail.com', mode: 'signup', name: 'Анна Петросян' });
  ok(reg.status === 200 && reg.data.devCode, 'регистрация выдала код: ' + reg.status);

  const twice = await api('POST', '/api/auth/request', { email: 'anna@mail.com', mode: 'signup', name: 'Анна' });
  ok(twice.status === 409 && twice.data.error === 'exists', 'повторная регистрация того же адреса отклонена: ' + twice.status);

  const again = await api('POST', '/api/auth/request', { email: 'anna@mail.com' });
  ok(again.status === 200, 'вход зарегистрированного работает: ' + again.status);

  /* --- интерфейс: регистрация, вход, кабинет --- */
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1340, height: 950 }, deviceScaleFactor: 1.5 });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  p.on('dialog', d => d.accept());
  await p.goto(base + '/app');
  await p.waitForTimeout(900);
  await p.click(".lang-auth [data-lang=\"ru\"]");
  await p.waitForTimeout(300);

  ok(await p.locator('[data-act="au-mode"][data-mode="signup"]').count() === 1, 'на экране входа есть вкладка регистрации');
  await p.click('[data-act="au-mode"][data-mode="signup"]');
  await p.waitForTimeout(300);
  ok(await p.locator('#au-name').count() === 1, 'форма регистрации спрашивает имя');
  await p.screenshot({ path: out + '/slate-signup.png' });

  // чужой адрес при регистрации, которая уже занята
  await p.fill('#au-name', 'Анна');
  await p.fill('#au-email', 'anna@mail.com');
  await p.click('[data-act="au-send"]');
  await p.waitForTimeout(700);
  ok(await p.locator('#au-name').count() === 0, 'занятый адрес переключил форму на вход');

  // настоящая регистрация
  await p.click('[data-act="au-mode"][data-mode="signup"]');
  await p.waitForTimeout(300);
  await p.fill('#au-name', 'Тигран Айвазян');
  await p.fill('#au-email', 'tigran@mail.com');
  await p.click('[data-act="au-send"]');
  await p.waitForTimeout(800);
  const banner = await p.locator('.banner').innerText().catch(() => '');
  const code = (banner.match(/\d{6}/) || [''])[0];
  ok(!!code, 'код показан на экране: ' + banner.slice(0, 60));
  await p.fill('#au-code', code);
  await p.click('[data-act="au-verify"]');
  await p.waitForTimeout(1500);
  ok(await p.locator('[data-tab="students"]').isVisible(), 'после регистрации открылась программа');
  const me = await p.evaluate(() => fetch('/api/me', { credentials: 'same-origin' }).then(r => r.json()));
  ok(me.user.email === 'tigran@mail.com', 'вошли под новым аккаунтом: ' + me.user.email);
  ok(me.user.name === 'Тигран Айвазян', 'имя сохранилось: ' + me.user.name);
  ok(me.school.plan === 'free' && me.limits.students === 2, 'новый аккаунт на бесплатном тарифе: ' + me.school.plan + ', учеников ' + me.limits.students);
  await p.screenshot({ path: out + '/slate-after-signup.png' });

  /* --- кабинет ученика на сервере --- */
  await p.click('[data-tab="students"]');
  await p.waitForTimeout(500);
  await p.click('[data-act="student-new"]');
  await p.waitForTimeout(400);
  await p.fill('#st-name', 'Ученик Первый');
  await p.click('.modal [data-act="submit"]');
  await p.waitForTimeout(1200);
  await p.keyboard.press('Escape');            // вопрос про абонемент — «Позже»
  await p.waitForTimeout(600);
  ok(await p.locator('[data-act="student-card"]').count() >= 1, 'ученик создан на сервере');
  // на бесплатном тарифе кабинет закрыт — так и должно быть
  await p.locator('[data-act="student-card"]').first().click();
  await p.waitForTimeout(700);
  await p.click('.modal [data-act="cab-share"]');
  await p.waitForTimeout(500);
  const wall = await p.locator('#modal').innerText();
  ok(/Pro/.test(wall), 'на бесплатном тарифе кабинет объясняет, что нужен Pro: ' + wall.replace(/\n+/g, ' ').slice(0, 90));
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);

  // переходим на Pro и берём ссылку
  await p.evaluate(() => fetch('/api/school/plan', { method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan: 'pro' }) }));
  await p.reload(); await p.waitForTimeout(1500);
  await p.click('[data-tab="students"]'); await p.waitForTimeout(600);
  await p.locator('[data-act="student-card"]').first().click();
  await p.waitForTimeout(700);
  await p.click('.modal [data-act="cab-share"]');
  await p.waitForTimeout(600);
  const url = await p.locator('#cab-url').inputValue();
  const cabCode = await p.locator('#cab-code').inputValue();
  ok(/\/s\/[A-Za-z0-9_-]+$/.test(url), 'ссылка кабинета ведёт на сервер: ' + url);

  const p2 = await b.newPage({ viewport: { width: 500, height: 900 } });
  const errs2 = []; p2.on('pageerror', e => errs2.push(String(e)));
  await p2.goto(url);
  await p2.waitForTimeout(900);
  ok((await p2.content()).includes('input'), 'страница кабинета открылась');
  const field = p2.locator('input').first();
  await field.fill(cabCode);
  await p2.keyboard.press('Enter');
  await p2.waitForTimeout(1200);
  const text = await p2.locator('body').innerText();
  ok(text.includes('Ученик Первый') || text.includes('занят') || text.includes('Осталось'),
     'кабинет открылся по коду: ' + text.replace(/\n+/g, ' | ').slice(0, 120));
  await p2.screenshot({ path: out + '/slate-portal.png' });
  ok(errs2.length === 0, 'в кабинете нет ошибок JS', errs2[0]);

  ok(errs.length === 0, 'в приложении нет ошибок JS', errs[0]);
  await b.close(); SRV.kill();
  console.log(L.join('\n'));
  console.log(fails ? `\nПРОВАЛОВ: ${fails}` : `\nВСЁ ЗЕЛЁНОЕ (${L.length} проверок)`);
  process.exit(fails ? 1 : 0);
})();
