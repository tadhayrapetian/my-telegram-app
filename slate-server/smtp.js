/* =============================================================================
   Отправка письма по SMTP. Нужна там, где нет своего домена: письмо уходит
   через обычный почтовый ящик (Gmail, Яндекс, Mail.ru) с паролем приложения.

   Зависимостей нет — протокол простой, а tls и net есть в самом Node.

   Поддерживаем оба способа подключения:
     порт 465 — TLS сразу (implicit),
     порт 587 — открытое соединение и команда STARTTLS.
   ========================================================================== */

const net = require("node:net");
const tls = require("node:tls");
const crypto = require("node:crypto");

/* Читалка ответов: сервер отвечает строками «250-…» (продолжение)
   и «250 …» (последняя). Ждём последнюю и отдаём код с текстом. */
function reader(socket) {
  let buf = "";
  const waiters = [];
  const feed = () => {
    let idx;
    while ((idx = buf.indexOf("\r\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const w = waiters[0];
      if (!w) continue;
      w.lines.push(line);
      if (/^\d{3} /.test(line)) {
        waiters.shift();
        w.resolve({ code: +line.slice(0, 3), text: w.lines.join("\n") });
      }
    }
  };
  socket.on("data", (d) => { buf += d.toString("utf8"); feed(); });
  return {
    next: () => new Promise((resolve, reject) => {
      waiters.push({ lines: [], resolve, reject });
      feed();
      setTimeout(() => reject(new Error("почтовый сервер молчит")), 20000).unref?.();
    }),
  };
}

function encodeHeader(value) {
  /* Заголовки — только ASCII, поэтому нелатиницу кодируем по RFC 2047 */
  return /^[\x20-\x7E]*$/.test(value)
    ? value
    : "=?UTF-8?B?" + Buffer.from(value, "utf8").toString("base64") + "?=";
}

function letter({ from, fromName, to, subject, text }) {
  const body = Buffer.from(text, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  return [
    `From: ${fromName ? encodeHeader(fromName) + " " : ""}<${from}>`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@slate>`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

async function sendSmtp(opts) {
  const { host, port, user, pass, from, fromName, to, subject, text } = opts;
  const implicit = opts.secure !== undefined ? opts.secure : Number(port) === 465;
  const allowPlain = opts.allowPlain === true;      /* только для тестов */

  let socket = implicit
    ? tls.connect({ host, port, servername: host, rejectUnauthorized: opts.rejectUnauthorized !== false })
    : net.connect({ host, port });

  const done = new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.once("connect", resolve);
    socket.once("secureConnect", resolve);
  });
  socket.setTimeout(20000, () => socket.destroy(new Error("почтовый сервер не отвечает")));
  await done;

  let io = reader(socket);
  const say = async (line, expect) => {
    if (line !== null) socket.write(line + "\r\n");
    const res = await io.next();
    if (expect && !expect.includes(res.code)) throw new Error(`SMTP ${res.code}: ${res.text.slice(0, 200)}`);
    return res;
  };

  try {
    await say(null, [220]);
    await say("EHLO slate", [250]);

    if (!implicit) {
      const upgrade = await say("STARTTLS", [220, 502, 454]);
      if (upgrade.code === 220) {
        socket = tls.connect({ socket, servername: host, rejectUnauthorized: opts.rejectUnauthorized !== false });
        await new Promise((resolve, reject) => {
          socket.once("secureConnect", resolve);
          socket.once("error", reject);
        });
        io = reader(socket);
        await say("EHLO slate", [250]);
      } else if (!allowPlain) {
        throw new Error("сервер не поддерживает STARTTLS — пароль пошёл бы открытым текстом");
      }
    }

    if (user) {
      await say("AUTH LOGIN", [334]);
      await say(Buffer.from(user, "utf8").toString("base64"), [334]);
      await say(Buffer.from(pass, "utf8").toString("base64"), [235]);
    }

    await say(`MAIL FROM:<${from}>`, [250]);
    await say(`RCPT TO:<${to}>`, [250, 251]);
    await say("DATA", [354]);
    socket.write(letter({ from, fromName, to, subject, text }).replace(/\r\n\./g, "\r\n..") + "\r\n.\r\n");
    await say(null, [250]);
    try { await say("QUIT", [221]); } catch (e) { /* прощаться не обязательно */ }
    return true;
  } finally {
    socket.destroy();
  }
}

module.exports = { sendSmtp, letter, encodeHeader };
