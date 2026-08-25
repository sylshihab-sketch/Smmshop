const { onRequest, onCall } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp();
const db = admin.firestore();

// আপনার টেলিগ্রাম বোটের টোকেন এখানে দিন
const BOT_TOKEN = "8895211701:AAGo31P6oWpyhM7KX2D-atbWxWAojIqZtVU";

// ৪টি চ্যানেলের ইউজারনেম (অবশ্যই বোটকে এই চ্যানেলগুলোতে Admin হতে হবে)
const REQUIRED_CHANNELS = [
  "@rdx_signel_gurup",
  "@the_earning_1122",
  "@mining_the_gorup",
  "@easy_income_cenel"
];

// ১. টেলিগ্রাম ইনিট ডেটা ভ্যালিডেশন ফাংশন (সিকিউরিটি নিশ্চিত করতে)
function verifyTelegramWebAppData(initData) {
  // প্রোডাকশনে টেলিগ্রামের নিয়ম অনুযায়ী initData হাশ ভেরিফাই করে নেওয়া ভালো
  // আপাতত ইউজার আইডি বের করার জন্য ডিকোড করছি
  try {
    const urlParams = new URLSearchParams(initData);
    const userStr = urlParams.get('user');
    if (!userStr) return null;
    return JSON.parse(userStr);
  } catch (e) {
    return null;
  }
}

// ২. ইউজার ৪টি চ্যানেলে জয়েন করেছে কিনা তা চেক করার API
exports.verifyUserChannels = onCall(async (request) => {
  const initData = request.data.initData;
  const user = verifyTelegramWebAppData(initData);
  
  if (!user || !user.id) {
    throw new Error("Unauthorized user");
  }

  const userId = user.id;

  try {
    for (const channel of REQUIRED_CHANNELS) {
      const response = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getChatMember`, {
        params: {
          chat_id: channel,
          user_id: userId
        }
      });

      const status = response.data.result.status;
      // যদি ইউজার লেফট বা কিকড হয়ে থাকে, তবে ভেরিফাই হবে না
      if (status === "left" || status === "kicked") {
        return { success: false, message: `Not joined in ${channel}` };
      }
    }

    // সব চ্যানেলে জয়েন করা থাকলে ডাটাবেসে আপডেট করে দেব
    await db.collection("users").doc(String(userId)).set({
      channelVerified: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return { success: true };
  } catch (error) {
    console.error("Error verifying channels:", error);
    // যদি বোট চ্যানেলে Admin না থাকে বা অন্য কোনো সমস্যা হয়
    return { success: false, message: "Verification error. Make sure bot is admin in channels." };
  }
});

// ৩. রেফারেল প্রসেসিং API
exports.processReferral = onCall(async (request) => {
  const { initData, referralId } = request.data;
  const user = verifyTelegramWebAppData(initData);
  
  if (!user || !user.id) return { success: false };

  const userId = String(user.id);
  const refId = String(referralId);

  if (userId === refId) return { success: false }; // নিজেকে নিজে রেফার রোধ করতে

  const userDocRef = db.collection("users").doc(userId);
  const userSnapshot = await userDocRef.get();

  // যদি ইউজার নতুন হয় তবেই রেফারেল কাউন্ট হবে
  if (!userSnapshot.exists) {
    const refDocRef = db.collection("users").doc(refId);
    
    await db.runTransaction(async (transaction) => {
      transaction.set(userDocRef, {
        balance: 0,
        referrals: 0,
        dailyAds: 0,
        invitedBy: refId,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      const refSnap = await transaction.get(refDocRef);
      const currentRefs = refSnap.exists ? (refSnap.data().referrals || 0) : 0;
      const currentBal = refSnap.exists ? (refSnap.data().balance || 0) : 0;

      transaction.set(refDocRef, {
        referrals: currentRefs + 1,
        balance: currentBal + 300 // রেফার বোনাস ৩০০ ATF
      }, { merge: true });
    });
  }
  return { success: true };
});

// ৪. মাইনিং কমপ্লিট API
exports.completeMining = onCall(async (request) => {
  const { rate, initData } = request.data;
  const user = verifyTelegramWebAppData(initData);
  if (!user || !user.id) throw new Error("Unauthorized");

  const userRef = db.collection("users").doc(String(user.id));
  await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(userRef);
    const currentBalance = doc.exists ? (doc.data().balance || 0) : 0;
    transaction.set(userRef, { balance: currentBalance + rate }, { merge: true });
  });

  return { success: true };
});

// ৫. স্পিন রিওয়ার্ড API
exports.rewardSpin = onCall(async (request) => {
  const { amount, initData } = request.data;
  const user = verifyTelegramWebAppData(initData);
  if (!user || !user.id) throw new Error("Unauthorized");

  const userRef = db.collection("users").doc(String(user.id));
  await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(userRef);
    const currentBalance = doc.exists ? (doc.data().balance || 0) : 0;
    transaction.set(userRef, { balance: currentBalance + amount }, { merge: true });
  });

  return { success: true };
});

// ৬. ডেইলি টাস্ক API
exports.completeTask = onCall(async (request) => {
  const { initData } = request.data;
  const user = verifyTelegramWebAppData(initData);
  if (!user || !user.id) throw new Error("Unauthorized");

  const userRef = db.collection("users").doc(String(user.id));
  await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(userRef);
    const data = doc.exists ? doc.data() : {};
    const dailyAds = (data.dailyAds || 0) + 1;
    const balance = (data.balance || 0) + 50; // প্রতি টাস্কে ৫০ ATF

    if (dailyAds > 30) throw new Error("Daily limit reached");

    transaction.set(userRef, { balance, dailyAds }, { merge: true });
  });

  return { success: true };
});

// ৭. উইথড্রল রিকোয়েস্ট API
exports.requestWithdrawal = onCall(async (request) => {
  const { wallet, network, initData } = request.data;
  const user = verifyTelegramWebAppData(initData);
  if (!user || !user.id) throw new Error("Unauthorized");

  const userId = String(user.id);
  const userRef = db.collection("users").doc(userId);
  const doc = await userRef.get();

  if (!doc.exists) throw new Error("User not found");
  const data = doc.data();

  if ((data.balance || 0) < 100000) throw new Error("Minimum withdrawal is 100,000 ATF");
  if ((data.referrals || 0) < 10) throw new Error("Minimum 10 referrals required");

  // উইথড্রল ডাটাবেসে সেভ করা
  await db.collection("withdrawals").add({
    userId,
    wallet,
    network,
    amount: data.balance,
    status: "pending",
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  // ব্যালেন্স জিরো করে দেওয়া
  await userRef.update({ balance: 0 });

  return { success: true, message: "Withdrawal request submitted successfully!" };
});