const axios = require("axios");

const TOKEN = process.env.TELEGRAM_TOKEN;
const PASSWORD = process.env.BOT_PASSWORD;
const DB_URL = process.env.FIREBASE_DB_URL;

let offset = 0;

// ============================
// Telegram API
// ============================

async function getUpdates() {
  const res = await axios.get(`https://api.telegram.org/bot${TOKEN}/getUpdates`, {
    params: {
      offset: offset,
      timeout: 30
    }
  });

  return res.data.result;
}

async function sendMessage(chatId, text) {
  try {
    await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: text
    });
  } catch (err) {
    console.log("Send error:", chatId);
  }
}

// ============================
// Firebase
// ============================

async function saveUser(chatId) {
  await axios.put(`${DB_URL}/users/${chatId}.json`, true);
}

async function getAllUsers() {
  const res = await axios.get(`${DB_URL}/users.json`);
  return res.data || {};
}

// ============================
// Broadcast
// ============================

async function broadcast(message) {
  const users = await getAllUsers();

  for (const chatId of Object.keys(users)) {
    await sendMessage(chatId, message);
  }
}

// ============================
// Bot Logic
// ============================

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  // start
  if (text === "/start") {
    return sendMessage(chatId, "أدخل كلمة السر للاشتراك 🔐");
  }

  // password
  if (text === PASSWORD) {
    await saveUser(chatId);
    return sendMessage(chatId, "تم الاشتراك بنجاح 🔔");
  }

  // broadcast
  if (text.startsWith("/send ")) {
    const message = text.replace("/send ", "");
    await broadcast(message);
    return sendMessage(chatId, "تم الإرسال لكل المشتركين ✅");
  }

  return sendMessage(chatId, "أمر غير معروف ❌");
}

// ============================
// Runner
// ============================

async function runBot() {
  console.log("Bot restarted at:", new Date());

  while (true) {
    try {
      const updates = await getUpdates();

      for (const update of updates) {
        offset = update.update_id + 1;

        if (update.message) {
          await handleMessage(update.message);
        }
      }

    } catch (err) {
      console.log("Error:", err.message);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

runBot();
