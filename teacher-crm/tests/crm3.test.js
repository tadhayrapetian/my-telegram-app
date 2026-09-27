/* Этап 3: оплаты и задолженности */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const out = '/tmp/claude-0/-home-user-my-telegram-app/83a4b403-bd6c-579e-8cdd-54291fb0f0f9/scratchpad';
const PORT = 8700 + Math.floor(Math.random() * 200), base = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'crm3-'));
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
  SRV.stderr.on('data', x => { const s = x.toString(); if (/Traceback/.test(s)) process.stderr.write('[py] ' + s); });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 300)); }

  // ученик с абонементом без оплаты → долг
  const a = (await api('POST', '/api/students', { name: 'Должник Давид' })).data;
  await api('POST', '/api/packages', { student_id: a.id, lessons_total: 8, purchased_on: d(-5), expires_on: d(40), price: 40000, pay_now: false });
  let debts = (await api('GET', '/api/payments/debts')).data;
  ok(debts.length === 1 && debts[0].debt === 40000, 'долг посчитан: ' + (debts[0] && debts[0].debt));

  // частичная оплата
  await api('POST', '/api/payments', { student_id: a.id, amount: 15000, paid_on: d(-2), method: 'перевод' });
  debts = (await api('GET', '/api/payments/debts')).data;
  ok(debts[0].debt === 25000, 'после частичной оплаты долг 25000: ' + debts[0].debt);

  // полная доплата убирает из должников
  await api('POST', '/api/payments', { student_id: a.id, amount: 25000, paid_on: d(-1), method: 'наличные' });
  debts = (await api('GET', '/api/payments/debts')).data;
  ok(debts.length === 0, 'после доплаты должников нет: ' + debts.length);

  // ожидаемая оплата не уменьшает долг, но видна отдельно
  const b2 = (await api('POST', '/api/students', { name: 'Ожидающая Нина' })).data;
  await api('POST', '/api/packages', { student_id: b2.id, lessons_total: 4, purchased_on: d(-3), price: 20000, pay_now: false });
  await api('POST', '/api/payments', { student_id: b2.id, amount: 20000, paid_on: d(0), status: 'pending', note: 'обещала завтра' });
  debts = (await api('GET', '/api/payments/debts')).data;
  const nina = debts.find(x => x.student_id === b2.id);
  ok(nina && nina.debt === 20000 && nina.pending === 20000, 'ожидаемая оплата не закрывает долг');

  // разовое занятие с ценой
  const c = (await api('POST', '/api/students', { name: 'Разовый Ашот' })).data;
  const one = (await api('POST', '/api/lessons', { student_id: c.id, date: d(-1), price: 5000, use_package: false })).data;
  await api('POST', `/api/lessons/${one.ids[0]}/status`, { status: 'done' });
  debts = (await api('GET', '/api/payments/debts')).data;
  const ashot = debts.find(x => x.student_id === c.id);
  ok(ashot && ashot.debt === 5000, 'проведённое разовое занятие даёт долг: ' + (ashot && ashot.debt));

  // сводка
  const sum = (await api('GET', '/api/payments/summary')).data;
  ok(sum.total === 40000, 'сумма полученного: ' + sum.total);
  ok(sum.by_month.length >= 1, 'разбивка по месяцам есть');

  // --- интерфейс
  const br = await chromium.launch();
  const p = await br.newPage({ viewport: { width: 1360, height: 950 }, deviceScaleFactor: 1.5, locale: 'ru-RU' });
  const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('dialog', x => x.accept());
  await p.goto(base + '/');
  await p.waitForTimeout(700);
  await p.click('[data-tab="payments"]');
  await p.waitForTimeout(700);
  const txt = await p.locator('.view').innerText();
  ok(txt.includes('Задолженности'), 'раздел оплат открылся');
  ok(txt.includes('Ожидающая Нина'), 'должник виден в списке');
  ok(await p.locator('tbody tr').count() >= 3, 'история платежей показана');
  await p.screenshot({ path: out + '/crm-payments.png' });

  // запись оплаты через интерфейс
  await p.click('[data-act="payment-new"]');
  await p.waitForTimeout(500);
  await p.selectOption('#pm-student', String(c.id));
  await p.fill('#pm-amount', '5000');
  await p.click('[data-act="submit"]');
  await p.waitForTimeout(900);
  const after = (await api('GET', '/api/payments/debts')).data.find(x => x.student_id === c.id);
  ok(!after, 'оплата из интерфейса закрыла долг');

  console.log(L.join('\n'));
  console.log('ОШИБКИ JS: ' + (errs.length ? errs.join('\n') : 'нет'));
  console.log(fails ? `ПРОВАЛЕНО: ${fails}` : 'Этап 3 — все проверки пройдены');
  await br.close(); SRV.kill();
  process.exit(fails || errs.length ? 1 : 0);
})();
