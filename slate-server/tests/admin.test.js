/* Админка сервиса: доступ только у владельца, список школ, смена тарифа */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const out = process.env.SHOTS || '/tmp/slate-shots';
const PORT = 5300 + Math.floor(Math.random() * 200), base = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-admin-'));
const L = []; let fails = 0;
const ok = (c, n, x) => { L.push((c ? '  ✓ ' : '  ✗ ') + n + (x ? ' — ' + x : '')); if (!c) fails++; };
let SRV = null;
process.on('exit', () => { try { SRV && SRV.kill('SIGKILL'); } catch (e) {} });
process.on('uncaughtException', e => { console.log(L.join('\n')); console.error('УПАЛО:', e.message); try { SRV.kill('SIGKILL'); } catch (x) {} process.exit(1); });

/* каждый «браузер» — своя пачка cookie */
function client() {
  let cookie = '';
  return async (m, u, b) => {
    const r = await fetch(base + u, {
      method: m, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: b ? JSON.stringify(b) : undefined,
    });
    const set = r.headers.get('set-cookie');
    if (set && /sid=/.test(set)) cookie = set.split(';')[0];
    return { status: r.status, data: await r.json().catch(() => null), cookie: () => cookie };
  };
}
async function signup(api, email, name) {
  const r = await api('POST', '/api/auth/request', { email, mode: 'signup', name });
  await api('POST', '/api/auth/verify', { email, code: r.data.devCode });
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  SRV = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), SLATE_DATA: DATA, SLATE_ADMIN: 'boss@mail.com' },
    stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/me')).status) break; } catch (e) {} await new Promise(r => setTimeout(r, 250)); }

  /* обычный преподаватель с учениками */
  const anna = client();
  await signup(anna, 'anna@mail.com', 'Анна Петросян');
  await anna('PUT', '/api/state', { version: 0, doc: {
    v: 2, lang: 'ru', cur: 'AMD', teacher: 'Анна', students: [
      { id: 's1', name: 'Мари', code: '1111' }, { id: 's2', name: 'Арам', code: '2222' }],
    lessons: [{ id: 'l1', studentId: 's1', date: '2026-10-01', time: '17:00', status: 'planned' }],
    payments: [], packs: [] } });

  /* второй преподаватель, чтобы школ было две */
  const boris = client();
  await signup(boris, 'boris@mail.com', 'Борис');

  /* --- посторонним админка недоступна --- */
  const denied = await anna('GET', '/api/admin');
  ok(denied.status === 403 && denied.data.error === 'not_admin', 'чужому админка закрыта: ' + denied.status);
  const planTry = await anna('POST', '/api/admin/plan', { schoolId: 'x', plan: 'studio' });
  ok(planTry.status === 403, 'и тариф чужой рукой не поменять: ' + planTry.status);

  const anon = await fetch(base + '/api/admin');
  ok(anon.status === 401, 'без входа — 401: ' + anon.status);

  /* --- владелец сервиса видит всё --- */
  const boss = client();
  await signup(boss, 'boss@mail.com', 'Хозяин');
  const view = await boss('GET', '/api/admin');
  ok(view.status === 200, 'админу открыто: ' + view.status);
  ok(view.data.schools.length === 3, 'видно все школы: ' + view.data.schools.length);
  const school = view.data.schools.find(s => s.people.some(p => p.email === 'anna@mail.com'));
  ok(!!school, 'школа Анны в списке');
  ok(school.name === 'Анна Петросян', 'школа названа по имени: ' + school.name);
  ok(school.students === 2, 'посчитаны ученики: ' + school.students);
  ok(school.lessons === 1, 'посчитаны занятия: ' + school.lessons);
  ok(school.plan === 'free', 'тариф по умолчанию бесплатный: ' + school.plan);
  ok(view.data.mail === null && view.data.telegram === false, 'видно, что почта и телеграм не настроены');

  /* --- смена тарифа рукой админа --- */
  const changed = await boss('POST', '/api/admin/plan', { schoolId: school.id, plan: 'pro' });
  ok(changed.status === 200, 'тариф сменён: ' + changed.status);
  const me = await anna('GET', '/api/me');
  ok(me.data.school.plan === 'pro' && me.data.limits.students === 15,
     'преподаватель сразу видит новый тариф: ' + me.data.school.plan + ', учеников ' + me.data.limits.students);
  const state = await anna('GET', '/api/state');
  ok(Object.keys(state.data.portal).length === 2, 'кабинеты учеников появились вместе с Pro: ' +
     Object.keys(state.data.portal).length);

  const bad = await boss('POST', '/api/admin/plan', { schoolId: school.id, plan: 'выдумка' });
  ok(bad.status === 400, 'несуществующий тариф отклонён: ' + bad.status);

  /* --- удаление школы --- */
  const victim = client();
  await signup(victim, 'lishniy@mail.com', 'Лишний');
  await victim('PUT', '/api/state', { version: 0, doc: {
    v: 2, students: [{ id: 'x1', name: 'Ученик', code: '3333' }], lessons: [], payments: [], packs: [] } });
  const before = (await boss('GET', '/api/admin')).data.schools;
  const target = before.find(x => x.people.some(p => p.email === 'lishniy@mail.com'));
  ok(!!target, 'лишняя школа появилась в списке');

  const noConfirm = await boss('POST', '/api/admin/delete', { schoolId: target.id, confirm: 'не та почта' });
  ok(noConfirm.status === 400 && noConfirm.data.error === 'confirm', 'без верного подтверждения не удаляет: ' + noConfirm.status);

  const mine = before.find(x => x.mine);
  ok(!!mine, 'своя школа помечена как своя');
  const selfKill = await boss('POST', '/api/admin/delete', { schoolId: mine.id, confirm: 'boss@mail.com' });
  ok(selfKill.status === 400 && selfKill.data.error === 'self', 'свою школу удалить нельзя: ' + selfKill.status);

  const byStranger = await anna('POST', '/api/admin/delete', { schoolId: target.id, confirm: 'lishniy@mail.com' });
  ok(byStranger.status === 403, 'посторонний удалить не может: ' + byStranger.status);

  const killed = await boss('POST', '/api/admin/delete', { schoolId: target.id, confirm: 'LISHNIY@mail.com' });
  ok(killed.status === 200 && killed.data.people === 1, 'школа удалена: ' + JSON.stringify(killed.data));
  const after = (await boss('GET', '/api/admin')).data.schools;
  ok(!after.some(x => x.id === target.id), 'её больше нет в списке: осталось ' + after.length);
  const ghost = await victim('GET', '/api/me');
  ok(ghost.status === 401, 'вход удалённого больше не работает: ' + ghost.status);
  const reborn = await victim('POST', '/api/auth/request', { email: 'lishniy@mail.com' });
  ok(reborn.status === 404, 'и аккаунта с этой почтой не осталось: ' + reborn.status);

  /* --- страница --- */
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1.5 });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(base + '/admin');
  await p.waitForTimeout(700);
  ok((await p.locator('#view').innerText()).includes('Нет доступа'), 'без входа страница говорит «нет доступа»');

  await p.context().addCookies([{ name: 'sid', value: boss('GET', '/api/me') && '', url: base }]).catch(() => {});
  /* входим в браузере как админ: тем же кодом, что и по API */
  const code = (await (await fetch(base + '/api/auth/request', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'boss@mail.com' }) })).json()).devCode;
  await p.goto(base + '/app');
  await p.waitForTimeout(800);
  await p.fill('#au-email', 'boss@mail.com');
  await p.click('[data-act="au-send"]'); await p.waitForTimeout(700);
  const shown = ((await p.locator('.banner').innerText().catch(() => '')).match(/\d{6}/) || [code])[0];
  await p.fill('#au-code', shown); await p.click('[data-act="au-verify"]'); await p.waitForTimeout(1500);

  await p.goto(base + '/admin');
  await p.waitForTimeout(900);
  const text = await p.locator('#view').innerText();
  ok(text.includes('anna@mail.com'), 'в админке видно преподавателей: ' + text.replace(/\n+/g, ' ').slice(0, 90));
  ok(text.includes('учеников'), 'видно счётчики');
  ok(await p.locator('[data-plan="studio"]').count() >= 1, 'есть кнопки смены тарифа');
  await p.screenshot({ path: out + '/slate-admin.png', fullPage: true });

  /* меняем тариф кнопкой */
  const annaRow = p.locator('.row', { hasText: 'anna@mail.com' }).locator('[data-plan="studio"]');
  await annaRow.click();
  await p.waitForTimeout(1200);
  const fresh = await boss('GET', '/api/admin');
  const nowSchool = fresh.data.schools.find(s => s.id === school.id);
  ok(nowSchool.plan === 'studio', 'кнопка в админке сменила тариф: ' + nowSchool.plan);
  ok(errs.length === 0, 'без ошибок JS', errs[0]);

  await b.close(); SRV.kill();
  console.log(L.join('\n'));
  console.log(fails ? `\nПРОВАЛОВ: ${fails}` : `\nВСЁ ЗЕЛЁНОЕ (${L.length} проверок)`);
  process.exit(fails ? 1 : 0);
})();
