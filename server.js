

const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

const allowedOrigins = (
  process.env.ALLOWED_ORIGINS ||
  "https://sharankalshetti161-code.github.io"
).split(",").map(x => x.trim());

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Origin not allowed"));
  }
}));

let db = null;

try {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error("Firebase service account is missing");
  }

  const serviceAccount = JSON.parse(
    process.env.FIREBASE_SERVICE_ACCOUNT
  );

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }

  db = admin.firestore();
  console.log("Firebase connected");
} catch (error) {
  console.error("Firebase setup error:", error.message);
}

function checkFirebase(req, res, next) {
  if (!db) {
    return res.status(503).json({
      error: "Firebase is not configured"
    });
  }
  next();
}

async function checkLogin(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.match(/^Bearer (.+)$/i);

    if (!token) {
      return res.status(401).json({
        error: "Please sign in first"
      });
    }

    req.user = await admin.auth().verifyIdToken(token[1]);
    next();
  } catch {
    return res.status(401).json({
      error: "Invalid or expired login"
    });
  }
}

const admins = new Set(
  (process.env.ADMIN_UIDS || "")
    .split(",").map(x => x.trim()).filter(Boolean)
);

function checkAdmin(req, res, next) {
  if (!admins.has(req.user.uid)) {
    return res.status(403).json({
      error: "Admin access required"
    });
  }
  next();
}

app.get("/", (req, res) => {
  res.json({
    app: "SK EARN",
    status: "Backend running",
    firebaseReady: !!db
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "OK", firebaseReady: !!db });
});

// Create a wallet with zero balance. Users cannot set their own balance.
app.post("/api/account", checkFirebase, checkLogin, async (req, res) => {
  try {
    const ref = db.collection("users").doc(req.user.uid);

    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);

      if (!snap.exists) {
        tx.set(ref, {
          uid: req.user.uid,
          phoneNumber: req.user.phone_number || null,
          balancePaise: 0,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    });

    const snap = await ref.get();

    res.json({
      balancePaise: snap.get("balancePaise") || 0,
      currency: "INR"
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Could not create account" });
  }
});

// Read wallet
app.get("/api/wallet", checkFirebase, checkLogin, async (req, res) => {
  try {
    const snap = await db.collection("users").doc(req.user.uid).get();

    if (!snap.exists) {
      return res.status(404).json({ error: "Create account first" });
    }

    res.json({
      balancePaise: snap.get("balancePaise") || 0,
      currency: "INR"
    });
  } catch {
    res.status(500).json({ error: "Could not load wallet" });
  }
});

// Read transaction history
app.get("/api/transactions", checkFirebase, checkLogin, async (req, res) => {
  try {
    const snap = await db.collection("transactions")
      .where("uid", "==", req.user.uid)
      .limit(50).get();

    res.json({
      transactions: snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }))
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Could not load transactions" });
  }
});

// Submit withdrawal request. This does not send money automatically.
app.post("/api/withdrawals", checkFirebase, checkLogin, async (req, res) => {
  const amountPaise = req.body.amountPaise;
  const upiId = String(req.body.upiId || "").trim();

  if (!Number.isSafeInteger(amountPaise) ||
      amountPaise < 10000 || amountPaise > 100000000) {
    return res.status(400).json({
      error: "Withdrawal minimum is ₹100"
    });
  }

  if (!/^[\w.-]+@[\w.-]+$/.test(upiId)) {
    return res.status(400).json({ error: "Invalid UPI ID" });
  }

  try {
    const userRef = db.collection("users").doc(req.user.uid);
    const withdrawalRef = db.collection("withdrawals").doc();
    const transactionRef = db.collection("transactions").doc();

    await db.runTransaction(async tx => {
      const user = await tx.get(userRef);

      if (!user.exists) throw new Error("NO_ACCOUNT");

      const balance = user.get("balancePaise") || 0;

      if (balance < amountPaise) throw new Error("LOW_BALANCE");

      tx.update(userRef, {
        balancePaise: balance - amountPaise
      });

      tx.set(withdrawalRef, {
        uid: req.user.uid,
        amountPaise,
        upiId,
        status: "pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      tx.set(transactionRef, {
        uid: req.user.uid,
        type: "withdrawal",
        amountPaise: -amountPaise,
        status: "pending",
        withdrawalId: withdrawalRef.id,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    res.status(201).json({
      message: "Withdrawal request submitted",
      withdrawalId: withdrawalRef.id,
      status: "pending"
    });
  } catch (error) {
    if (error.message === "NO_ACCOUNT") {
      return res.status(404).json({ error: "Create account first" });
    }
    if (error.message === "LOW_BALANCE") {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    console.error(error.message);
    res.status(500).json({ error: "Withdrawal request failed" });
  }
});

// Admin: view pending withdrawals
app.get("/api/admin/withdrawals",
  checkFirebase, checkLogin, checkAdmin,
  async (req, res) => {
    try {
      const snap = await db.collection("withdrawals")
        .where("status", "==", "pending")
        .limit(100).get();

      res.json({
        withdrawals: snap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
      });
    } catch {
      res.status(500).json({ error: "Could not load requests" });
    }
  }
);

app.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("SK EARN backend started");
});
