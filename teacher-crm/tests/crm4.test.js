/* Этап 4: материалы, дашборд, экспорт, бэкап */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const out = '/tmp/claude-0/-home-user-my-telegram-app/83a4b403-bd6c-579e-8cdd-54291fb0f0f9/scratchpad';
const PORT = 8900 + Math.floor(Math.random() * 90), base = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'crm4-'));
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

const pdf = path.join(DATA, 'Unit 5.pdf');
fs.writeFileSync(pdf, Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'));

(async () => {
  SRV = spawn('python3', ['-m', 'uvicorn', 'app.main:app', '--port', String(PORT), '--host', '127.0.0.1'],
    { cwd: '/home/user/my-telegram-app/teacher-crm', env: { ...process.env, CRM_DATA: DATA }, stdio: ['ignore', 'pipe', 'pipe'] });
  SRV.stderr.on('data', x => { const s = x.toString(); if (/Traceback/.test(s)) process.stderr.write('[py] ' + s); });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 300)); }

  // данные
  const st = (await api('POST', '/api/students', { name: 'Ани Саркисян', level: 'B2' })).data;
  await api('POST', '/api/packages', { student_id: st.id, lessons_total: 3, purchased_on: d(-10), expires_on: d(25), price: 18000, pay_now: false });
  const l1 = (await api('POST', '/api/lessons', { student_id: st.id, date: d(-2), topic: 'Present Perfect' })).data;
  await api('POST', `/api/lessons/${l1.ids[0]}/status`, { status: 'done' });
  await api('POST', '/api/lessons', { student_id: st.id, date: d(1), topic: 'Speaking' });

  // материал-ссылка
  const link = (await api('POST', '/api/materials/link', { title: 'Grammar drills', url: 'example.com/drills', student_id: st.id })).data;
  ok(link.url.startsWith('https://'), 'ссылка нормализована: ' + link.url);

  // загрузка файла
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(pdf)], { type: 'application/pdf' }), 'Unit 5.pdf');
  form.append('title', 'Unit 5');
  form.append('student_id', String(st.id));
  const up = await fetch(base + '/api/materials/upload', { method: 'POST', body: form });
  const upData = await up.json();
  ok(up.status === 200 && upData.size > 0, 'файл загружен: ' + upData.size + ' байт');

  const fileResp = await fetch(base + `/api/materials/${upData.id}/file`);
  ok(fileResp.status === 200 && fileResp.headers.get('content-type').includes('pdf'), 'файл отдаётся с правильным типом');

  const mats = (await api('GET', `/api/materials?student_id=${st.id}`)).data;
  ok(mats.length === 2, 'материалы привязаны к ученику: ' + mats.length);

  // дашборд
  const dash = (await api('GET', '/api/dashboard')).data;
  ok(dash.students_count === 1, 'в сводке верное число учеников');
  ok(dash.debts.length === 1 && dash.debts[0].debt === 18000, 'сводка знает про долг: ' + (dash.debts[0] && dash.debts[0].debt));
  ok(dash.package_warnings.length === 1, 'сводка предупреждает про абонемент');
  ok(dash.upcoming.length === 1, 'в сводке есть ближайшее занятие');
  ok(dash.done_month >= 1, 'проведённые за месяц посчитаны: ' + dash.done_month);

  // экспорт
  const csv = await fetch(base + '/api/export/lessons.csv');
  const text = await csv.text();
  ok(csv.status === 200 && text.includes('Present Perfect') && text.includes('ученик'), 'CSV занятий выгружается');
  ok(csv.headers.get('content-disposition').includes('lessons-'), 'CSV приходит как файл');
  const csvPay = await (await fetch(base + '/api/export/payments.csv')).text();
  ok(csvPay.split('\n')[0].includes('сумма'), 'CSV оплат с русскими заголовками');

  // бэкап
  const bk = (await api('POST', '/api/backup', {})).data;
  ok(bk.ok && bk.size > 1000, 'резервная копия создана: ' + bk.file);
  const list = (await api('GET', '/api/backups')).data;
  ok(list.items.length === 1, 'копия видна в списке');

  // --- интерфейс
  const br = await chromium.launch();
  const p = await br.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1.5, locale: 'ru-RU' });
  const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('dialog', x => x.accept());
  await p.goto(base + '/');
  await p.waitForTimeout(900);
  ok((await p.locator('.top h1').innerText()) === 'Сводка', 'программа открывается на сводке');
  const dashText = await p.locator('.view').innerText();
  ok(dashText.includes('Абонементы на исходе') && dashText.includes('Кто должен'), 'блоки сводки на месте');
  await p.screenshot({ path: out + '/crm-dashboard.png' });

  await p.click('[data-tab="materials"]');
  await p.waitForTimeout(600);
  ok((await p.locator('.row').count()) === 2, 'материалы показаны в разделе');
  await p.screenshot({ path: out + '/crm-materials.png' });

  await p.click('[data-tab="settings"]');
  await p.waitForTimeout(600);
  await p.fill('#se-currency', '₽');
  await p.click('[data-act="settings-save"]');
  await p.waitForTimeout(700);
  const cur = (await api('GET', '/api/settings')).data.currency;
  ok(cur === '₽', 'валюта сохранилась: ' + cur);
  await p.click('[data-act="backup"]');
  await p.waitForTimeout(800);
  ok((await api('GET', '/api/backups')).data.items.length === 2, 'кнопка бэкапа сделала вторую копию');
  await p.screenshot({ path: out + '/crm-settings.png' });

  console.log(L.join('\n'));
  console.log('ОШИБКИ JS: ' + (errs.length ? errs.join('\n') : 'нет'));
  console.log(fails ? `ПРОВАЛЕНО: ${fails}` : 'Этап 4 — все проверки пройдены');
  await br.close(); SRV.kill();
  process.exit(fails || errs.length ? 1 : 0);
})();
