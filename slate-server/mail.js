/* =============================================================================
   Отправка писем. Без зависимостей: почтовые службы принимают обычный HTTPS,
   и одного fetch достаточно.

   Служба выбирается переменной SLATE_MAIL:
     smtp    — обычный почтовый ящик (Gmail, Яндекс, Mail.ru) с паролем
               приложения: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS.
               Домен для этого не нужен — письма идут от вашего адреса.
     resend  — RESEND_API_KEY   (resend.com, 3000 писем в месяц бесплатно)
     brevo   — BREVO_API_KEY    (brevo.com, 300 писем в день бесплатно)
     custom  — SLATE_MAIL_URL   (свой приёмник, нужен для тестов)
     нет     — письма не отправляются, код виден в логе и в ответе сервера

   Отправитель задаётся SLATE_MAIL_FROM, например: Slate <hello@getslate.com>.
   Адрес должен быть на домене, подтверждённом в почтовой службе, иначе
   письма уйдут в спам или не уйдут вовсе.
   ========================================================================== */

const { sendSmtp } = require("./smtp");

const PROVIDER = (process.env.SLATE_MAIL || "").trim().toLowerCase();
/* для почтового ящика отправитель по умолчанию — он сам */
const FROM = process.env.SLATE_MAIL_FROM ||
  (process.env.SMTP_USER ? `Slate <${process.env.SMTP_USER}>` : "Slate <no-reply@localhost>");

const configured = () =>
  (PROVIDER === "smtp" && !!process.env.SMTP_HOST && !!process.env.SMTP_USER) ||
  (PROVIDER === "resend" && !!process.env.RESEND_API_KEY) ||
  (PROVIDER === "brevo" && !!process.env.BREVO_API_KEY) ||
  (PROVIDER === "custom" && !!process.env.SLATE_MAIL_URL);

/* Адрес вида «Имя <box@dom.com>» разбираем — службам нужны части отдельно. */
function parseFrom(value) {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value);
  return m ? { name: m[1] || "Slate", email: m[2] } : { name: "Slate", email: value.trim() };
}

async function post(url, headers, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return true;
}

/* Отправляет письмо. Возвращает true, если служба его приняла.
   Когда служба не настроена — false, и вызывающий покажет код на экране. */
async function send({ to, subject, text }) {
  if (!configured()) return false;
  const from = parseFrom(FROM);

  if (PROVIDER === "smtp") {
    return sendSmtp({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS || "",
      from: from.email, fromName: from.name, to, subject, text,
      allowPlain: process.env.SMTP_ALLOW_PLAIN === "1",          /* только для тестов */
      rejectUnauthorized: process.env.SMTP_INSECURE !== "1",
    });
  }
  if (PROVIDER === "resend") {
    return post("https://api.resend.com/emails",
      { authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      { from: FROM, to: [to], subject, text });
  }
  if (PROVIDER === "brevo") {
    return post("https://api.brevo.com/v3/smtp/email",
      { "api-key": process.env.BREVO_API_KEY },
      { sender: from, to: [{ email: to }], subject, textContent: text });
  }
  return post(process.env.SLATE_MAIL_URL, {}, { from: FROM, to, subject, text });
}

/* Письмо с кодом входа. Два языка сразу: какой у человека — мы ещё не знаем. */
function codeLetter(code) {
  return {
    subject: `Slate — код входа ${code}`,
    text:
`Ваш код для входа в Slate: ${code}

Код действует 10 минут. Если вы не запрашивали вход — просто не отвечайте
на это письмо, никто не получит доступ к вашим данным.

--
Your Slate sign-in code: ${code}
It expires in 10 minutes. If you did not request it, ignore this email.`,
  };
}

module.exports = { send, codeLetter, configured, PROVIDER, FROM };
