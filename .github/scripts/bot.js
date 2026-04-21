/**
 * ═══════════════════════════════════════════════════════════
 *  Telegram Broadcast Bot — bot.js
 * ═══════════════════════════════════════════════════════════
 */

const axios  = require('axios');

// ── Environment Variables ──────────────────────────────────
const TG_TOKEN     = process.env.TELEGRAM_TOKEN;
const FIREBASE_DB  = process.env.FIREBASE_DB_URL;
const ADMIN_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// 🔥 الحل النهائي هنا
const BOT_PASSWORD = (process.env.BOT_PASSWORD || '20262024').trim();

if (!TG_TOKEN || !FIREBASE_DB) {
  console.error('❌ Missing TELEGRAM_TOKEN or FIREBASE_DB_URL');
  process.exit(1);
}

const API = `https://api.telegram.org/bot${TG_TOKEN}`;

// ── حالات المحادثة ────────────────────────────────────────
const pendingAuth = new Set();

// ── Firebase Helpers ──────────────────────────────────────
async function fbGet(path) {
  try {
    const res = await axios.get(`${FIREBASE_DB}/${path}.json`);
    return res.data;
  } catch (e) {
    console.error('Firebase GET error:', e.message);
    return null;
  }
}

async function fbSet(path, data) {
  try {
    await axios.put(`${FIREBASE_DB}/${path}.json`, data);
    return true;
  } catch (e) {
    console.error('Firebase SET error:', e.message);
    return false;
  }
}

async function fbDelete(path) {
  try {
    await axios.delete(`${FIREBASE_DB}/${path}.json`);
    return true;
  } catch (e) {
    console.error('Firebase DELETE error:', e.message);
    return false;
  }
}

// ── Subscribers ───────────────────────────────────────────
async function getSubscribers() {
  const data = await fbGet('botSubscribers');
  if (!data || typeof data !== 'object') return [];
  return Object.values(data);
}

async function isSubscribed(chatId) {
  const data = await fbGet(`botSubscribers/${chatId}`);
  return !!data;
}

async function addSubscriber(chatId, username) {
  return fbSet(`botSubscribers/${chatId}`, {
    chatId: String(chatId),
    username: username || '',
    authorizedAt: new Date().toISOString(),
    active: true
  });
}

async function removeSubscriber(chatId) {
  return fbDelete(`botSubscribers/${chatId}`);
}

// ── Telegram API ──────────────────────────────────────────
async function sendMessage(chatId, text, options = {}) {
  try {
    await axios.post(`${API}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      ...options
    });
    return true;
  } catch (e) {
    const status = e.response?.status;
    const desc   = e.response?.data?.description || e.message;

    if (status === 403 || desc?.includes('blocked') || desc?.includes('chat not found')) {
      console.log(`🚫 Removing blocked user: ${chatId}`);
      await removeSubscriber(chatId);
    } else {
      console.error(`Send error to ${chatId}:`, desc);
    }
    return false;
  }
}

// ── Handlers ─────────────────────────────────────────────
async function handleStart(chatId, username) {
  pendingAuth.add(chatId);
  await sendMessage(chatId,
    `👋 <b>مرحباً بك في نظام إشعارات الموقع</b>\n\n` +
    `🔐 أدخل كلمة السر للاشتراك:\n` +
    `<i>(كلمة سر خاصة)</i>`
  );
}

async function handleStop(chatId) {
  const exists = await isSubscribed(chatId);
  if (exists) {
    await removeSubscriber(chatId);
    await sendMessage(chatId, `✅ تم إلغاء الاشتراك.`);
  } else {
    await sendMessage(chatId, `ℹ️ أنت غير مشترك.`);
  }
}

async function handleStatus(chatId) {
  const exists = await isSubscribed(chatId);
  await sendMessage(chatId,
    exists ? `✅ أنت مشترك.` : `❌ غير مشترك.`
  );
}

async function handleSubscribersCount(chatId) {
  if (String(chatId) !== String(ADMIN_CHAT_ID)) {
    return sendMessage(chatId, `⛔ للأدمن فقط`);
  }
  const subs = await getSubscribers();
  await sendMessage(chatId, `👥 عدد المشتركين: ${subs.length}`);
}

// 🔥 تحسين قوي هنا
async function handlePassword(chatId, text, username) {
  if (!pendingAuth.has(chatId)) return false;

  pendingAuth.delete(chatId);

  const cleanInput = text.replace(/\s/g, '');

  if (cleanInput === BOT_PASSWORD.replace(/\s/g, '')) {

    const alreadyExists = await isSubscribed(chatId);

    if (alreadyExists) {
      return sendMessage(chatId, `✅ أنت مشترك بالفعل`);
    }

    const ok = await addSubscriber(chatId, username);

    if (ok) {
      await sendMessage(chatId, `🎉 تم الاشتراك بنجاح`);

      if (ADMIN_CHAT_ID && String(chatId) !== String(ADMIN_CHAT_ID)) {
        await sendMessage(ADMIN_CHAT_ID,
          `🔔 مشترك جديد\n@${username || 'unknown'}\nID: ${chatId}`
        );
      }
    } else {
      await sendMessage(chatId, `⚠️ خطأ في الحفظ`);
    }

  } else {
    await sendMessage(chatId,
      `❌ كلمة السر غير صحيحة\nأرسل /start للمحاولة مجددًا`
    );
  }

  return true;
}

// ── Processor ────────────────────────────────────────────
async function processUpdate(update) {
  const msg = update.message || update.edited_message;
  if (!msg || !msg.text) return;

  const chatId   = msg.chat.id;
  const text     = msg.text.trim();
  const username = msg.from?.username || msg.from?.first_name || '';

  console.log(`📨 ${chatId}: ${text}`);

  if (text.startsWith('/start')) return handleStart(chatId, username);
  if (text === '/stop') return handleStop(chatId);
  if (text === '/status') return handleStatus(chatId);
  if (text === '/subscribers') return handleSubscribersCount(chatId);

  const handled = await handlePassword(chatId, text, username);

  if (!handled) {
    await sendMessage(chatId,
      `/start\n/stop\n/status`
    );
  }
}

// ── Polling ──────────────────────────────────────────────
let lastUpdateId = 0;

async function getUpdates() {
  try {
    const res = await axios.get(`${API}/getUpdates`, {
      params: { offset: lastUpdateId + 1, timeout: 30 }
    });
    return res.data.result || [];
  } catch (e) {
    console.error('getUpdates error:', e.message);
    return [];
  }
}

async function poll() {
  console.log('🤖 Bot started...');

  try {
    await axios.post(`${API}/deleteWebhook`);
  } catch(e) {}

  while (true) {
    const updates = await getUpdates();

    for (const update of updates) {
      lastUpdateId = update.update_id;
      await processUpdate(update);
    }
  }
}

// ── Run ──────────────────────────────────────────────────
if (require.main === module) {
  poll().catch(console.error);
}
