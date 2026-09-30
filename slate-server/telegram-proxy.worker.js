/* =============================================================================
   Переходник к Telegram для серверов, откуда api.telegram.org недоступен
   (российские дата-центры — обычный случай).

   Это код для Cloudflare Workers: бесплатно, карта не нужна, 100 000
   запросов в сутки. Нам хватит с огромным запасом — бот опрашивает
   Telegram примерно 2 500 раз в сутки.

   Как поставить:
     1. dash.cloudflare.com → регистрация (можно через Google).
     2. Слева «Workers & Pages» → «Create» → «Create Worker» → имя,
        например slate-tg → «Deploy».
     3. «Edit code», удалить всё, вставить этот файл целиком → «Deploy».
     4. Cloudflare покажет адрес вида https://slate-tg.ВАШ-ЛОГИН.workers.dev
     5. На сервере в /opt/slate/slate.env добавить строку:
            SLATE_TG_API=https://slate-tg.ВАШ-ЛОГИН.workers.dev
        и выполнить: systemctl restart slate

   Что делает: принимает запрос вида /bot<ТОКЕН>/<метод> и передаёт его
   в api.telegram.org, возвращая ответ как есть. Больше ничего.

   Про безопасность: через переходник идёт токен вашего бота, поэтому
   адрес воркера никому не давайте. Чужой запрос отсекается проверкой
   пути — всё, что не начинается с /bot, получает отказ.
   ========================================================================== */

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/bot")) {
      return new Response("Slate → Telegram\n", { status: 404 });
    }

    const target = "https://api.telegram.org" + url.pathname + url.search;
    const upstream = new Request(target, {
      method: request.method,
      headers: { "content-type": request.headers.get("content-type") || "application/json" },
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    });

    try {
      const res = await fetch(upstream);
      /* отдаём ответ Telegram без изменений — бот разбирает его сам */
      return new Response(res.body, { status: res.status, headers: { "content-type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, description: "proxy: " + e.message }),
        { status: 502, headers: { "content-type": "application/json" } });
    }
  },
};
