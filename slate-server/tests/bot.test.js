/* Телеграм: привязка, напоминания, сообщения. Настоящий Telegram заменён
   поддельным — проверяем, что и когда уходит. */
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const L = []; let fails = 0;
const ok = (c, n, x) => { L.push((c ? '  ✓ ' : '  ✗ ') + n + (x ? ' — ' + x : '')); if (!c) fails++; };

/* ------------------------------------------------ поддельный api.telegram.org */
const outbox = [];                 // отправленные сообщения
let updates = [];                  // что бот «получит» при следующем опросе
const TG_PORT = 4700 + Math.floor(Math.random() * 200);
const tg = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const method = req.url.split('/').pop();
    const data = JSON.parse(body || '{}');
    const reply = (result) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, result })); };
    if (method === 'getMe') return reply({ id: 1, username: 'slate_test_bot' });
    if (method === 'getUpdates') { const u = updates; updates = []; return reply(u); }
    if (method === 'sendMessage') { outbox.push(data); return reply({ message_id: outbox.length }); }
    reply({});
  });
});

const PORT = 4800 + Math.floor(Math.random() * 200), base = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-bot-'));
let SRV = null;
process.on('exit', () => { try { SRV && SRV.kill('SIGKILL'); } catch (e) {} });
process.on('uncaughtException', e => { console.log(L.join('\n')); console.error('УПАЛО:', e.message); try { SRV.kill('SIGKILL'); } catch (x) {} process.exit(1); });

let cookie = '';
const api = async (m, u, b, extra) => {
  const r = await fetch(base + u, {
    method: m,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(extra || {}) },
    body: b ? JSON.stringify(b) : undefined,
  });
  const set = r.headers.get('set-cookie');
  if (set && /sid=/.test(set)) cookie = set.split(';')[0];
  return { status: r.status, data: await r.json().catch(() => null), set };
};
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const hhmm = (mins) => { const d = new Date(Date.now() + mins * 60000); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const waitFor = async (fn, ms = 8000) => {
  const till = Date.now() + ms;
  while (Date.now() < till) { if (fn()) return true; await new Promise(r => setTimeout(r, 200)); }
  return false;
};

(async () => {
  await new Promise(r => tg.listen(TG_PORT, r));

  SRV = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), SLATE_DATA: DATA,
           SLATE_BOT_TOKEN: '111:TEST', SLATE_TG_API: `http://127.0.0.1:${TG_PORT}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = [];
  SRV.stdout.on('data', d => log.push(d.toString()));
  SRV.stderr.on('data', d => log.push(d.toString()));
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/me')).status) break; } catch (e) {} await new Promise(r => setTimeout(r, 250)); }

  ok(await waitFor(() => log.join('').includes('@slate_test_bot')), 'бот представился при запуске');

  /* --- преподаватель регистрируется и привязывает телеграм --- */
  const reg = await api('POST', '/api/auth/request', { email: 'anna@mail.com', mode: 'signup', name: 'Анна' });
  await api('POST', '/api/auth/verify', { email: 'anna@mail.com', code: reg.data.devCode });
  await api('POST', '/api/school/plan', { plan: 'pro' });

  const st = await api('GET', '/api/telegram');
  ok(st.data.enabled === true && st.data.bot === 'slate_test_bot', 'приложение знает про бота: @' + st.data.bot);
  ok(st.data.linked === false, 'пока не привязан');

  const link = await api('POST', '/api/telegram/link');
  ok(/^https:\/\/t\.me\/slate_test_bot\?start=.+/.test(link.data.url), 'ссылка привязки: ' + link.data.url);
  const code = link.data.url.split('start=')[1];

  /* человек нажал «Старт» в телеграме */
  updates = [{ update_id: 1, message: { chat: { id: 555 }, from: { first_name: 'Анна' }, text: '/start ' + code } }];
  ok(await waitFor(() => outbox.some(m => String(m.chat_id) === '555')), 'бот ответил на привязку');
  ok(/расписание на день/.test(outbox.find(m => String(m.chat_id) === '555').text), 'и объяснил, что будет присылать');
  ok((await api('GET', '/api/telegram')).data.linked === true, 'привязка видна в программе');

  /* --- ученик с занятием через час --- */
  const soonTime = hhmm(50);
  const doc = {
    v: 2, lang: 'ru', cur: 'AMD', teacher: 'Анна', defRate: 5000, defDur: 60, countNoShow: true,
    students: [{ id: 's1', name: 'Мари', code: '1234', currency: 'AMD' }],
    lessons: [
      { id: 'l1', studentId: 's1', date: day(0), time: soonTime, status: 'planned', online: true, link: 'https://meet.example/x' },
      { id: 'l2', studentId: 's1', date: day(1), time: '17:00', status: 'planned', hw: 'Unit 5' },
    ],
    payments: [], packs: [],
  };
  const put = await api('PUT', '/api/state', { version: 0, doc });
  ok(put.status === 200, 'данные сохранены: ' + put.status);
  const token = put.data.portal.s1;
  ok(!!token, 'кабинет ученика получил токен');

  /* ученик заходит в кабинет и привязывает телеграм */
  const enter = await fetch(base + '/api/portal', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, code: '1234' }) });
  const pcookie = (enter.headers.get('set-cookie') || '').split(';')[0];
  ok(enter.status === 200 && /psid=/.test(pcookie), 'ученик вошёл в кабинет: ' + enter.status);

  const plink = await fetch(base + '/api/portal/telegram', { method: 'POST', headers: { cookie: pcookie } });
  const pdata = await plink.json();
  ok(/start=/.test(pdata.url || ''), 'ученику выдана ссылка привязки');
  updates = [{ update_id: 2, message: { chat: { id: 777 }, from: { first_name: 'Мари' }, text: '/start ' + pdata.url.split('start=')[1] } }];
  ok(await waitFor(() => outbox.some(m => String(m.chat_id) === '777')), 'бот привязал ученика');

  /* --- напоминание за два часа --- */
  outbox.length = 0;
  ok(await waitFor(() => outbox.some(m => String(m.chat_id) === '777' && /занятие в /.test(m.text)), 70000),
     'ученику пришло напоминание о ближайшем занятии');
  const soon = outbox.find(m => String(m.chat_id) === '777' && /занятие в /.test(m.text));
  ok(/онлайн/.test(soon.text) && /meet\.example/.test(soon.text), 'в напоминании есть ссылка на онлайн-занятие');

  const before = outbox.filter(m => /занятие в /.test(m.text)).length;
  await new Promise(r => setTimeout(r, 2000));
  ok(outbox.filter(m => /занятие в /.test(m.text)).length === before, 'второй раз то же напоминание не шлётся');

  /* --- расписание преподавателю --- */
  const agenda = outbox.find(m => String(m.chat_id) === '555' && /Сегодня, /.test(m.text));
  ok(!!agenda, 'преподавателю пришло расписание на день');
  ok(agenda && agenda.text.includes('Мари'), 'в расписании есть ученик: ' + (agenda ? agenda.text.replace(/\n/g, ' | ') : ''));

  /* --- сообщения в переписке --- */
  outbox.length = 0;
  await api('POST', '/api/messages', { studentId: 's1', text: 'Домашку сделали?' });
  ok(await waitFor(() => outbox.some(m => String(m.chat_id) === '777' && /Домашку/.test(m.text))),
     'сообщение преподавателя ушло ученику в телеграм');
  ok(outbox.find(m => /Домашку/.test(m.text)).text.startsWith('Анна:'), 'подписано именем преподавателя');

  outbox.length = 0;
  await fetch(base + '/api/portal/message', { method: 'POST', headers: { 'content-type': 'application/json', cookie: pcookie },
    body: JSON.stringify({ text: 'Да, сделала' }) });
  ok(await waitFor(() => outbox.some(m => String(m.chat_id) === '555' && /сделала/.test(m.text))),
     'ответ ученика ушёл преподавателю');
  ok(outbox.find(m => /сделала/.test(m.text)).text.startsWith('Мари:'), 'подписано именем ученика');

  /* --- отключение --- */
  outbox.length = 0;
  updates = [{ update_id: 3, message: { chat: { id: 777 }, text: '/stop' } }];
  ok(await waitFor(() => outbox.some(m => /Отключил/.test(m.text))), 'команда /stop отключает напоминания');
  outbox.length = 0;
  await api('POST', '/api/messages', { studentId: 's1', text: 'Проверка' });
  await new Promise(r => setTimeout(r, 1500));
  ok(!outbox.some(m => String(m.chat_id) === '777'), 'после /stop ученику больше не пишем');

  /* --- без токена бот молчит и не мешает --- */
  SRV.kill();
  const DATA2 = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-nobot-'));
  const PORT2 = PORT + 1;
  const srv2 = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT2), SLATE_DATA: DATA2 },
    stdio: ['ignore', 'pipe', 'pipe'] });
  const log2 = [];
  srv2.stdout.on('data', d => log2.push(d.toString()));
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT2}/api/me`)).status) break; } catch (e) {} await new Promise(r => setTimeout(r, 250)); }
  ok(log2.join('').includes('бот не настроен'), 'без токена сервер прямо говорит, что напоминаний не будет');
  srv2.kill();

  tg.close();
  console.log(L.join('\n'));
  console.log(fails ? `\nПРОВАЛОВ: ${fails}` : `\nВСЁ ЗЕЛЁНОЕ (${L.length} проверок)`);
  process.exit(fails ? 1 : 0);
})();
