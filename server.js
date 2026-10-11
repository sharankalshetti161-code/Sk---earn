
import { initializeApp } from
  "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";

import {
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

// Firebase Console मधील तुझी खरी config इथे भर.
const firebaseConfig = {
  apiKey: "AIzaSyBZdXYk8mDXsZ7lwqRdPAYOt3bDVvMay4Q",
  authDomain: "sk-earn-9d241.firebaseapp.com",
  projectId: "sk-earn-9d241",
  appId: "1:613897902500:web:17554beea14bae744b8931"
};

// Render backend
const API_URL = "https://sk-earn.onrender.com";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

let confirmationResult = null;
let recaptchaVerifier = null;

const $ = id => document.getElementById(id);

function message(id, text) {
  $(id).textContent = text;
}

async function api(path, options = {}) 

  const token = await user.getIdToken();

  const response = await fetch(API_URL + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + token,
      ...(options.headers || {})
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

$("sendOtp").addEventListener("click", async () => {
  try {
    const phone = $("phone").value.trim();

    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
      throw new Error("Number +91XXXXXXXXXX अशा format मध्ये टाक.");
    }

    $("sendOtp").disabled = true;

    if (!recaptchaVerifier) {
      recaptchaVerifier = new RecaptchaVerifier(
        auth,
        "recaptcha-container",
        { size: "normal" }
      );

      await recaptchaVerifier.render();
    }

    confirmationResult = await signInWithPhoneNumber(
      auth,
      phone,
      recaptchaVerifier
    );

    message("loginStatus", "OTP पाठवला. SMS तपास.");
  } catch (error) {
    message("loginStatus", error.message);
  } finally {
    $("sendOtp").disabled = false;
  }
});

$("verifyOtp").addEventListener("click", async () => {
  try {
    if (!confirmationResult) {
      throw new Error("आधी Send OTP कर.");
    }

    const code = $("otp").value.trim();

    if (!/^\d{6}$/.test(code)) {
      throw new Error("6 digit OTP टाक.");
    }

    await confirmationResult.confirm(code);
    message("loginStatus", "Login successful!");
    await refreshWallet();
  } catch (error) {
    message("loginStatus", error.message);
  }
});

async function refreshWallet() {
  try {
    const data = await api("/wallet");
    $("balance").textContent =
      "₹" + Number(data.balance || 0).toFixed(2);
  } catch (error) {
    message("loginStatus", error.message);
  }
}

$("refreshWallet").addEventListener("click", refreshWallet);

$("withdraw").addEventListener("click", async () => {
  try {
    const amount = Number($("amount").value);
    const upiId = $("upi").value.trim();

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("योग्य amount टाक.");
    }

    if (!upiId || !upiId.includes("@")) {
      throw new Error("योग्य UPI ID टाक.");
    }

    const result = await api("/withdraw", {
      method: "POST",
      body: JSON.stringify({ amount, upiId })
    });

    message("withdrawStatus", result.message);
    await refreshWallet();
  } catch (error) {
    message("withdrawStatus", error.message);
  }
});

$("loadTransactions").addEventListener("click", async () => {
  try {
    const data = await api("/transactions");
    const list = $("transactions");
    list.replaceChildren();

    if (!data.transactions.length) {
      const item = document.createElement("li");
      item.textContent = "Transactions नाहीत.";
      list.appendChild(item);
      return;
    }

    data.transactions.forEach(transaction => {
      const item = document.createElement("li");
      item.textContent =
        `${transaction.type || "Transaction"} — ₹${transaction.amount ?? 0} — ${transaction.status || "recorded"}`;
      list.appendChild(item);
    });
  } catch (error) {
    message("loginStatus", error.message);
  }
});
