/* Письма с кодом входа: уходят, не уходят, и что видит человек */
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const L = []; let fails = 0;
const ok = (c, n, x) => { L.push((c ? '  ✓ ' : '  ✗ ') + n + (x ? ' — ' + x : '')); if (!c) fails++; };

const letters = [];          // сюда «почтовая служба» складывает письма
let mailStatus = 200;
const MAIL_PORT = 4300 + Math.floor(Math.random() * 200);
const mailbox = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    if (mailStatus !== 200) { res.writeHead(mailStatus); return res.end('{"error":"nope"}'); }
    letters.push(JSON.parse(body || '{}'));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"id":"test"}');
  });
});

const servers = [];
process.on('exit', () => { for (const s of servers) { try { s.kill('SIGKILL'); } catch (e) {} } });
process.on('uncaughtException', e => { console.log(L.join('\n')); console.error('УПАЛО:', e.message); process.exit(1); });

function startSlate(env) {
  const PORT = 4500 + Math.floor(Math.random() * 300);
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-mail-'));
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), SLATE_DATA: DATA, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servers.push(srv);
  const log = [];
  srv.stdout.on('data', d => log.push(d.toString()));
  srv.stderr.on('data', d => log.push(d.toString()));
  return { base: `http://127.0.0.1:${PORT}`, log, srv };
}
const api = async (base, u, b) => {
  const r = await fetch(base + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const wait = async (base) => {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/me')).status) return; } catch (e) {} await new Promise(r => setTimeout(r, 250)); }
};

(async () => {
  await new Promise(r => mailbox.listen(MAIL_PORT, r));
  const MAIL_URL = `http://127.0.0.1:${MAIL_PORT}/send`;

  /* --- почта не настроена: код показываем, иначе войти нельзя --- */
  const plain = startSlate({});
  await wait(plain.base);
  const r1 = await api(plain.base, '/api/auth/request', { email: 'a@mail.com', mode: 'signup', name: 'Анна' });
  ok(r1.status === 200 && !!r1.data.devCode, 'без почтовой службы код возвращается на экран');
  ok(r1.data.mailed === false, 'и честно помечен как неотправленный');
  ok(plain.log.join('').includes('почта не настроена'), 'сервер предупредил об этом при запуске');
  plain.srv.kill();

  /* --- почта настроена: письмо уходит, кода на экране нет --- */
  const mailed = startSlate({ SLATE_MAIL: 'custom', SLATE_MAIL_URL: MAIL_URL, SLATE_MAIL_FROM: 'Slate <hi@getslate.com>' });
  await wait(mailed.base);
  const r2 = await api(mailed.base, '/api/auth/request', { email: 'boris@mail.com', mode: 'signup', name: 'Борис' });
  ok(r2.status === 200, 'регистрация прошла: ' + r2.status);
  ok(r2.data.devCode === undefined, 'кода на экране больше нет');
  ok(r2.data.mailed === true, 'сервер сообщил, что письмо ушло');
  ok(letters.length === 1, 'письмо получено почтовой службой: ' + letters.length);
  const letter = letters[0] || {};
  ok(letter.to === 'boris@mail.com', 'адрес получателя верный: ' + letter.to);
  ok(letter.from === 'Slate <hi@getslate.com>', 'отправитель из настройки: ' + letter.from);
  ok(/Slate — код входа \d{6}/.test(letter.subject || ''), 'в теме письма есть код: ' + letter.subject);
  const code = (String(letter.text || '').match(/\d{6}/) || [''])[0];
  ok(!!code, 'в письме есть шестизначный код');
  ok(/10 минут/.test(letter.text) && /ignore this email/.test(letter.text), 'письмо на двух языках и предупреждает о сроке');

  /* код из письма действительно пускает внутрь */
  const v = await api(mailed.base, '/api/auth/verify', { email: 'boris@mail.com', code });
  ok(v.status === 200, 'код из письма пускает в программу: ' + v.status);

  /* --- почтовая служба отвечает ошибкой: молчать нельзя --- */
  mailStatus = 500;
  const bad = await api(mailed.base, '/api/auth/request', { email: 'vera@mail.com', mode: 'signup', name: 'Вера' });
  ok(bad.status === 502 && bad.data.error === 'mail_failed', 'сбой почты виден вызывающему: ' + bad.status);
  ok(mailed.log.join('').includes('не ушло'), 'сбой записан в лог сервера');
  mailStatus = 200;
  mailed.srv.kill();

  mailbox.close();
  console.log(L.join('\n'));
  console.log(fails ? `\nПРОВАЛОВ: ${fails}` : `\nВСЁ ЗЕЛЁНОЕ (${L.length} проверок)`);
  process.exit(fails ? 1 : 0);
})();
