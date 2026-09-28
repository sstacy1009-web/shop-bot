// Node 18+. Запуск: npm i express && node server.js
const express = require("express");
const path = require("path");

const BOT_TOKEN = process.env.BOT_TOKEN;               // от @BotFather
const PROVIDER_TOKEN = process.env.PROVIDER_TOKEN;     // от BotFather → Payments
const APP_URL = process.env.APP_URL;                   // https://ваш-домен (HTTPS)
const CURRENCY = process.env.CURRENCY || "RUB";
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Цены в минимальных единицах (копейки/центы): 129000 = 1290.00
const PRODUCTS = [
  { id: 1, name: "Кофе в зёрнах 250 г", desc: "Арабика, средняя обжарка", price: 129000, img: "https://picsum.photos/seed/coffee/600/400" },
  { id: 2, name: "Керамическая кружка", desc: "Ручная работа, 300 мл", price: 89000, img: "https://picsum.photos/seed/mug/600/400" },
  { id: 3, name: "Пуровер", desc: "Воронка для фильтр-кофе", price: 249000, img: "https://picsum.photos/seed/pour/600/400" },
];

const tg = (method, body) =>
  fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/products", (_, res) => res.json({ products: PRODUCTS, currency: CURRENCY }));

// Создаёт ссылку на счёт. Сумма считается на сервере, а не берётся с клиента.
app.post("/api/invoice", async (req, res) => {
  const items = (req.body.items || [])
    .map(({ id, qty }) => ({ p: PRODUCTS.find((x) => x.id === id), qty: Math.floor(qty) }))
    .filter((x) => x.p && x.qty > 0 && x.qty <= 99);
  if (!items.length) return res.status(400).json({ error: "Корзина пуста" });

  const r = await tg("createInvoiceLink", {
    title: "Заказ в магазине",
    description: items.map((x) => `${x.p.name} × ${x.qty}`).join(", ").slice(0, 250),
    payload: JSON.stringify(items.map((x) => [x.p.id, x.qty])),
    provider_token: PROVIDER_TOKEN,
    currency: CURRENCY,
    prices: items.map((x) => ({ label: `${x.p.name} × ${x.qty}`, amount: x.p.price * x.qty })),
    need_name: true,
    need_phone_number: true,
    need_shipping_address: true,
  });
  if (!r.ok) return res.status(500).json({ error: r.description });
  res.json({ url: r.result });
});

// Бот: /start, подтверждение оплаты, уведомление о заказе
async function poll(offset = 0) {
  try {
    const { result = [] } = await fetch(`${API}/getUpdates?timeout=30&offset=${offset}`).then((r) => r.json());
    for (const u of result) {
      offset = u.update_id + 1;
      if (u.message?.text === "/start") {
        await tg("sendMessage", {
          chat_id: u.message.chat.id,
          text: "Добро пожаловать! Откройте каталог:",
          reply_markup: { inline_keyboard: [[{ text: "Открыть магазин", web_app: { url: APP_URL } }]] },
        });
      }
      if (u.pre_checkout_query) {
        await tg("answerPreCheckoutQuery", { pre_checkout_query_id: u.pre_checkout_query.id, ok: true });
      }
      if (u.message?.successful_payment) {
        const p = u.message.successful_payment;
        await tg("sendMessage", {
          chat_id: u.message.chat.id,
          text: `Оплата получена: ${(p.total_amount / 100).toFixed(2)} ${p.currency}. Заказ принят!`,
        });
        console.log("НОВЫЙ ЗАКАЗ", p.invoice_payload, p.order_info); // отправьте себе/в CRM
      }
    }
  } catch (e) { console.error(e); await new Promise((r) => setTimeout(r, 3000)); }
  poll(offset);
}

app.listen(process.env.PORT || 3000, async () => {
  // Кнопка меню рядом с полем ввода
  await tg("setChatMenuButton", { menu_button: { type: "web_app", text: "Магазин", web_app: { url: APP_URL } } });
  poll();
});
