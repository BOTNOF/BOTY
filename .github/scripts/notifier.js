/**
 * ═══════════════════════════════════════════════════════════
 *  Notifier — notifier.js  (UPGRADED: Broadcast to all subscribers)
 *  المسار في المشروع: .github/scripts/notifier.js
 *
 *  التغييرات عن النسخة السابقة:
 *    ✅ يجلب كل المشتركين من Firebase (botSubscribers)
 *    ✅ يرسل كل إشعار لجميع المشتركين بدلاً من chat_id واحد
 *    ✅ إذا حجب مستخدم البوت → يُحذف تلقائياً من القاعدة
 *    ✅ 100% من منطق الإشعارات الأصلي محفوظ بدون أي تعديل
 * ═══════════════════════════════════════════════════════════
 */

const axios = require('axios');
const fs    = require('fs');

// ── Environment Variables ──────────────────────────────────
const DB_URL    = process.env.FIREBASE_DB_URL;
const TG_TOKEN  = process.env.TELEGRAM_TOKEN;
const TG_CHAT   = process.env.TELEGRAM_CHAT_ID;   // يُستخدم كـ fallback فقط
const SENT_FILE = '.github/scripts/sent_ids.json';

// ── Load sent IDs (لمنع إرسال نفس الإشعار مرتين) ─────────
let sentIds = {};
if (fs.existsSync(SENT_FILE)) {
  try { sentIds = JSON.parse(fs.readFileSync(SENT_FILE, 'utf8')); } catch(e) {}
}

// ══════════════════════════════════════════════════════════
//  🆕 BROADCAST SYSTEM — الجديد الوحيد في هذا الملف
// ══════════════════════════════════════════════════════════

/**
 * جلب كل chat_ids المشتركين المصرّح لهم من Firebase
 * إذا لم يوجد أحد → نرجع chat_id الأدمن كـ fallback
 */
async function getSubscriberIds() {
  try {
    const res = await axios.get(`${DB_URL}/botSubscribers.json`);
    if (res.data && typeof res.data === 'object') {
      const ids = Object.values(res.data)
        .filter(s => s && s.chatId)
        .map(s => String(s.chatId));
      if (ids.length > 0) {
        console.log(`📋 Found ${ids.length} subscriber(s)`);
        return ids;
      }
    }
  } catch(e) {
    console.error('Error fetching subscribers:', e.message);
  }

  // Fallback: الأدمن الأصلي فقط
  console.log('⚠️  No subscribers found — falling back to TELEGRAM_CHAT_ID');
  return TG_CHAT ? [TG_CHAT] : [];
}

/**
 * إزالة مشترك حجب البوت من Firebase
 */
async function removeBlockedSubscriber(chatId) {
  try {
    await axios.delete(`${DB_URL}/botSubscribers/${chatId}.json`);
    console.log(`🗑️  Removed blocked subscriber: ${chatId}`);
  } catch(e) {
    console.error(`Failed to remove ${chatId}:`, e.message);
  }
}

/**
 * إرسال رسالة واحدة لمشترك واحد مع معالجة الأخطاء
 */
async function sendToOne(chatId, text) {
  try {
    await axios.post(
      `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,
      { chat_id: chatId, text, parse_mode: 'HTML' }
    );
    return true;
  } catch(e) {
    const status = e.response?.status;
    const desc   = e.response?.data?.description || e.message;

    if (
      status === 403 ||
      (desc && (desc.includes('blocked') || desc.includes('chat not found') || desc.includes('deactivated')))
    ) {
      // المستخدم حجب البوت → احذفه من القاعدة
      await removeBlockedSubscriber(chatId);
    } else {
      console.error(`TG Error [${chatId}]:`, desc);
    }
    return false;
  }
}

/**
 * 🔑 الدالة الرئيسية الجديدة — تُرسل لكل المشتركين
 * تستبدل sendTG القديمة تماماً
 */
async function sendTG(text) {
  const ids = await getSubscriberIds();

  if (ids.length === 0) {
    console.warn('⚠️  No recipients — message not sent');
    return;
  }

  // إرسال متوازٍ لجميع المشتركين
  const results = await Promise.allSettled(
    ids.map(id => sendToOne(id, text))
  );

  const sent   = results.filter(r => r.status === 'fulfilled' && r.value).length;
  const failed = results.length - sent;
  console.log(`📤 Broadcast: ${sent} sent, ${failed} failed (out of ${ids.length})`);
}

// ══════════════════════════════════════════════════════════
//  ✅ منطق الإشعارات الأصلي — لم يتغير شيء هنا
// ══════════════════════════════════════════════════════════

async function checkAndNotify(path, type) {
  try {
    const res = await axios.get(`${DB_URL}/${path}.json`);
    if (!res.data || typeof res.data !== 'object') return;

    for (const [id, d] of Object.entries(res.data)) {
      const key = `${type}_${id}`;
      if (sentIds[key]) continue;
      if (type !== 'support' && d.status !== 'pending') continue;

      let msg = '';
      if (type === 'deposit') {
        msg =
          `💰 <b>إيداع جديد!</b>\n` +
          `👤 المستخدم: ${(d.username||'').replace('u_','')}\n` +
          `💵 المبلغ: ${d.amount} EGP\n` +
          `🔢 رقم الطلب: ${d.orderId||id}\n` +
          `📞 من رقم: ${d.fromNumber||'—'}\n` +
          `🕐 الوقت: ${new Date(d.timestamp||Date.now()).toLocaleString('ar-EG')}`;
      } else if (type === 'withdraw') {
        msg =
          `🏧 <b>سحب جديد!</b>\n` +
          `👤 المستخدم: ${(d.username||'').replace('u_','')}\n` +
          `💵 المبلغ: ${d.amount} EGP\n` +
          `🔢 رقم الطلب: ${d.orderId||id}\n` +
          `💳 المحفظة: ${d.walletNumber||'—'}\n` +
          `🕐 الوقت: ${new Date(d.timestamp||Date.now()).toLocaleString('ar-EG')}`;
      } else if (type === 'bonus') {
        msg =
          `🎁 <b>بونص إحالة جديد!</b>\n` +
          `👤 المُحيل: ${d.referrerPhone||d.referrer||'—'}\n` +
          `👥 الصديق: ${d.depositorPhone||d.depositor||'—'}\n` +
          `💵 مبلغ الإيداع: ${d.depositAmount||0} EGP\n` +
          `🎉 قيمة البونص: ${d.bonusAmount||100} EGP`;
      } else if (type === 'support') {
        msg =
          `🎧 <b>شكوى/دعم جديد!</b>\n` +
          `📱 الهاتف: ${d.phone||'—'}\n` +
          `❓ المشكلة: ${d.issueType||'—'}\n` +
          `📝 التفاصيل: ${d.details||'—'}\n` +
          `🕐 الوقت: ${new Date(d.timestamp||Date.now()).toLocaleString('ar-EG')}`;
      }

      // 🆕 هنا: sendTG أصبحت ترسل لكل المشتركين
      await sendTG(msg);
      sentIds[key] = true;
      console.log(`✅ Sent: ${key}`);
    }
  } catch(e) {
    console.error(`Error checking ${path}:`, e.message);
  }
}

// ── Main ──────────────────────────────────────────────────
async function main() {
  console.log('🔍 Checking Firebase...');
  await checkAndNotify('depositRequests',  'deposit');
  await checkAndNotify('withdrawRequests', 'withdraw');
  await checkAndNotify('pendingBonuses',   'bonus');
  await checkAndNotify('supportTickets',   'support');
  fs.writeFileSync(SENT_FILE, JSON.stringify(sentIds, null, 2));
  console.log('✅ Done!');
}

main().catch(console.error);
