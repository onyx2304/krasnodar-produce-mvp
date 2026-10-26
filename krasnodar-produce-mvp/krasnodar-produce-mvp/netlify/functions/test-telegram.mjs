
export default async (request) => {
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const key = new URL(request.url).searchParams.get("key");

  if (!key || key !== process.env.TELEGRAM_TEST_KEY) {
    return new Response("Forbidden", { status: 403 });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return new Response("Telegram is not configured", {
      status: 503
    });
  }

  const telegram = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: "Тестовое сообщение «Зелёная корзина»: подключение Telegram работает."
      })
    }
  );

  if (!telegram.ok) {
    console.error("Telegram test failed", await telegram.text());
    return new Response("Telegram delivery failed", {
      status: 502
    });
  }

  return new Response("Test message sent", {
    status: 200
  });
};

