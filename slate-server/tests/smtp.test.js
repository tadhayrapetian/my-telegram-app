/* Отправка через обычный почтовый ящик: разговариваем с поддельным SMTP */
const net = require('node:net');
const path = require('node:path');
const { sendSmtp } = require(path.join(__dirname, '..', 'smtp.js'));
const L = []; let fails = 0;
const ok = (c, n, x) => { L.push((c ? '  ✓ ' : '  ✗ ') + n + (x ? ' — ' + x : '')); if (!c) fails++; };

/* Поддельный почтовый сервер: записывает диалог и принимает письмо.
   mode: 'ok' | 'badauth' | 'reject' */
function fakeSmtp(mode = 'ok') {
  const log = [];
  const letters = [];
  const srv = net.createServer((sock) => {
    let data = false, body = [];
    sock.write('220 fake ESMTP\r\n');
    sock.on('data', (chunk) => {
      for (const line of chunk.toString('utf8').split('\r\n')) {
        if (line === '' && !data) continue;
        if (data) {
          if (line === '.') {
            data = false;
            letters.push(body.join('\r\n')); body = [];
            sock.write('250 accepted\r\n');
          } else body.push(line);
          continue;
        }
        log.push(line);
        const up = line.toUpperCase();
        if (up.startsWith('EHLO')) sock.write('250-fake\r\n250-STARTTLS\r\n250 AUTH LOGIN\r\n');
        else if (up === 'STARTTLS') sock.write('502 not here\r\n');       /* в тесте без шифрования */
        else if (up === 'AUTH LOGIN') sock.write('334 VXNlcm5hbWU6\r\n');
        else if (up.startsWith('MAIL FROM')) sock.write(mode === 'reject' ? '550 no\r\n' : '250 ok\r\n');
        else if (up.startsWith('RCPT TO')) sock.write('250 ok\r\n');
        else if (up === 'DATA') { data = true; sock.write('354 go ahead\r\n'); }
        else if (up === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else if (/^[A-Za-z0-9+/=]+$/.test(line)) {
          /* это base64 логина или пароля */
          const prev = log[log.length - 2] || '';
          if (prev.toUpperCase() === 'AUTH LOGIN') sock.write('334 UGFzc3dvcmQ6\r\n');
          else sock.write(mode === 'badauth' ? '535 bad password\r\n' : '235 welcome\r\n');
        } else sock.write('250 ok\r\n');
      }
    });
    sock.on('error', () => {});
  });
  return { srv, log, letters };
}

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

(async () => {
  /* --- обычная отправка --- */
  const box = fakeSmtp('ok');
  const port = await listen(box.srv);
  const sent = await sendSmtp({
    host: '127.0.0.1', port, user: 'anna@gmail.com', pass: 'app-password',
    from: 'anna@gmail.com', fromName: 'Slate', to: 'boris@mail.com',
    subject: 'Slate — код входа 123456',
    text: 'Ваш код: 123456\nДействует 10 минут.',
    allowPlain: true,
  });
  ok(sent === true, 'письмо отправлено');
  ok(box.log.some(l => l.startsWith('EHLO')), 'поздоровались (EHLO)');
  ok(box.log.includes('AUTH LOGIN'), 'выполнен вход в ящик');
  ok(box.log.includes('MAIL FROM:<anna@gmail.com>'), 'отправитель правильный: ' + box.log.find(l => l.startsWith('MAIL FROM')));
  ok(box.log.includes('RCPT TO:<boris@mail.com>'), 'получатель правильный');
  ok(box.letters.length === 1, 'сервер получил ровно одно письмо: ' + box.letters.length);

  const letter = box.letters[0] || '';
  ok(/^From: Slate <anna@gmail\.com>/m.test(letter), 'в письме есть подпись отправителя');
  ok(/^To: <boris@mail\.com>/m.test(letter), 'в письме есть получатель');
  ok(/^Subject: =\?UTF-8\?B\?/m.test(letter), 'русская тема закодирована по правилам: ' +
     (letter.match(/^Subject: .*/m) || [''])[0].slice(0, 60));
  const subj = Buffer.from((letter.match(/^Subject: =\?UTF-8\?B\?(.+)\?=/m) || [])[1] || '', 'base64').toString('utf8');
  ok(subj === 'Slate — код входа 123456', 'тема читается обратно: ' + subj);
  const body = Buffer.from(letter.split('\r\n\r\n').slice(1).join('\r\n').replace(/\r\n/g, ''), 'base64').toString('utf8');
  ok(body.includes('Ваш код: 123456'), 'текст письма на русском не побился: ' + body.split('\n')[0]);
  box.srv.close();

  /* --- неверный пароль приложения --- */
  const bad = fakeSmtp('badauth');
  const badPort = await listen(bad.srv);
  let err = '';
  try {
    await sendSmtp({ host: '127.0.0.1', port: badPort, user: 'anna@gmail.com', pass: 'wrong',
                     from: 'anna@gmail.com', to: 'x@y.com', subject: 'test', text: 'test', allowPlain: true });
  } catch (e) { err = e.message; }
  ok(/535/.test(err), 'неверный пароль виден в ошибке: ' + err.slice(0, 60));
  bad.srv.close();

  /* --- сервер отказался принимать --- */
  const rej = fakeSmtp('reject');
  const rejPort = await listen(rej.srv);
  err = '';
  try {
    await sendSmtp({ host: '127.0.0.1', port: rejPort, user: 'a@b.c', pass: 'p',
                     from: 'a@b.c', to: 'x@y.com', subject: 'test', text: 'test', allowPlain: true });
  } catch (e) { err = e.message; }
  ok(/550/.test(err), 'отказ сервера виден в ошибке: ' + err.slice(0, 60));
  rej.srv.close();

  /* --- без шифрования пароль не отправляем --- */
  const plain = fakeSmtp('ok');
  const plainPort = await listen(plain.srv);
  err = '';
  try {
    await sendSmtp({ host: '127.0.0.1', port: plainPort, user: 'a@b.c', pass: 'p',
                     from: 'a@b.c', to: 'x@y.com', subject: 'test', text: 'test' });  /* allowPlain не задан */
  } catch (e) { err = e.message; }
  ok(/STARTTLS/.test(err), 'без шифрования пароль не уходит: ' + err.slice(0, 70));
  ok(!plain.log.includes('AUTH LOGIN'), 'вход в ящик даже не начинался: ' + plain.log.join(' | '));
  plain.srv.close();

  console.log(L.join('\n'));
  console.log(fails ? `\nПРОВАЛОВ: ${fails}` : `\nВСЁ ЗЕЛЁНОЕ (${L.length} проверок)`);
  process.exit(fails ? 1 : 0);
})();
