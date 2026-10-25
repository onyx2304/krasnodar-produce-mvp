import { createClient } from "@supabase/supabase-js";

const json = (statusCode, body) => new Response(JSON.stringify(body), {
  status: statusCode,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  }
});

const text = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";

export default async (request) => {
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });

  // Explicit opt-in: real orders remain disabled until the operator configures all services.
  if (process.env.ENABLE_ORDERS !== "true") {
    return json(503, { error: "Приём заказов отключён: проект находится в демо-режиме." });
  }

  const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length) return json(503, { error: "Сервер не настроен. Не хватает конфигурации: " + missing.join(", ") });

  let payload;
  try { payload = await request.json(); }
  catch { return json(400, { error: "Некорректный JSON" }); }

  const customer = {
    name: text(payload.name, 80),
    phone: text(payload.phone, 30),
    address: text(payload.address, 500),
    note: text(payload.note, 500)
  };
  if (!customer.name || !customer.phone || !customer.address) return json(400, { error: "Заполните имя, телефон и адрес." });
  if (!Array.isArray(payload.items) || payload.items.length < 1 || payload.items.length > 40) return json(400, { error: "Некорректный состав заказа." });

  const requested = new Map();
  for (const item of payload.items) {
    const id = text(item?.productId, 80);
    const qty = Number(item?.quantity);
    if (!id || !Number.isFinite(qty) || qty <= 0 || qty > 50) return json(400, { error: "Некорректный товар или количество." });
    requested.set(id, (requested.get(id) || 0) + qty);
  }
  if ([...requested.values()].some(q => q > 50)) return json(400, { error: "Слишком большое количество одного товара." });

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const ids = [...requested.keys()];
    const { data: products, error: productError } = await supabase
      .from("products").select("id,name,price_minor,unit,is_active").in("id", ids);
    if (productError) throw productError;
    if (!products || products.length !== ids.length || products.some(p => !p.is_active)) {
      return json(409, { error: "Некоторые товары недоступны. Обновите каталог и попробуйте снова." });
    }

    const productById = new Map(products.map(p => [p.id, p]));
    const items = ids.map(id => {
      const p = productById.get(id);
      const quantity = requested.get(id);
      const lineTotal = Math.round(Number(p.price_minor) * quantity);
      return {
        product_id: p.id,
        product_name: p.name,
        quantity,
        unit: p.unit,
        unit_price_minor: Number(p.price_minor),
        line_total_minor: lineTotal
      };
    });
    const subtotal = items.reduce((sum, item) => sum + item.line_total_minor, 0);
    if (subtotal < 100000) return json(400, { error: "Минимальная сумма товаров для заказа — 1 000 ₽." });

    const { data: order, error: orderError } = await supabase.from("orders").insert({
      customer_name: customer.name,
      customer_phone: customer.phone,
      delivery_address: customer.address,
      customer_note: customer.note || null,
      status: "new",
      subtotal_minor: subtotal,
      delivery_fee_minor: null,
      total_minor: null,
      currency: "RUB"
    }).select("id,created_at").single();
    if (orderError) throw orderError;

    const rows = items.map(item => ({ ...item, order_id: order.id }));
    const { error: itemsError } = await supabase.from("order_items").insert(rows);
    if (itemsError) {
      await supabase.from("orders").delete().eq("id", order.id);
      throw itemsError;
    }

    const formatRub = minor => (minor / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
    const lines = items.map(i => `• ${i.product_name}: ${i.quantity} ${i.unit} × ${formatRub(i.unit_price_minor)} ₽ = ${formatRub(i.line_total_minor)} ₽`);
    const message = [
      "🛒 Новый заказ #" + order.id.slice(0, 8),
      "",
      ...lines,
      "",
      "Товары: " + formatRub(subtotal) + " ₽",
      "Доставка: требует подтверждения",
      "Клиент: " + customer.name,
      "Телефон: " + customer.phone,
      "Адрес: " + customer.address,
      customer.note ? "Комментарий: " + customer.note : "",
      "",
      "Статус: новый — подтвердите наличие и стоимость доставки."
    ].filter(Boolean).join("\n");

    const telegramResponse = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: message })
    });

    if (!telegramResponse.ok) {
      // Order remains stored; report that notification failed so it can be recovered from the database.
      console.error("Telegram notification failed", await telegramResponse.text());
      return json(202, { orderId: order.id, warning: "Заказ сохранён, но уведомление не отправлено. Проверьте серверные журналы." });
    }

    return json(201, { orderId: order.id, message: "Заявка создана. Ожидайте подтверждения наличия и доставки." });
  } catch (error) {
    console.error("create-order error", error?.message || error);
    return json(500, { error: "Не удалось создать заказ. Попробуйте позже." });
  }
};
