const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const authMiddleware = require("../middleware/auth");

// ── SIMPLE IN-MEMORY RATE LIMITER ─────────────────────────────
// Limits login attempts to 5 per IP per 15 minutes
// No external package required — works with the existing stack
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Periodically clean up expired entries to avoid memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of loginAttempts.entries()) {
    if (now > data.resetAt) loginAttempts.delete(ip);
  }
}, 10 * 60 * 1000); // clean every 10 minutes

const loginRateLimiter = (req, res, next) => {
  const ip = req.ip || req.connection?.remoteAddress || "unknown";
  const now = Date.now();
  let entry = loginAttempts.get(ip);

  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
  }

  if (entry.count >= MAX_ATTEMPTS) {
    const retryAfterMinutes = Math.ceil((entry.resetAt - now) / 1000 / 60);
    return res.status(429).json({
      success: false,
      message: `Too many login attempts. Please try again in ${retryAfterMinutes} minute(s).`,
    });
  }

  entry.count++;
  loginAttempts.set(ip, entry);
  req._loginIp = ip; // pass IP to route for reset on success
  next();
};

// ── ADMIN STORE ────────────────────────────────────────────────
// Note: adminStore is in-memory and resets on server restart.
// For production, persist admin credentials in MongoDB or use
// environment variables exclusively for the password hash.
let adminStore = null;

const getAdmin = () => {
  if (!adminStore) {
    adminStore = {
      username: process.env.ADMIN_USERNAME || "admin",
      passwordHash: bcrypt.hashSync(
        process.env.ADMIN_PASSWORD || "spicejar@admin123",
        10
      ),
    };
  }
  return adminStore;
};

// ── ROUTES ─────────────────────────────────────────────────────

// POST /api/auth/login
router.post("/login", loginRateLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: "Username and password required." });
    }

    const admin = getAdmin();

    if (username !== admin.username) {
      return res.status(401).json({ success: false, message: "Invalid credentials." });
    }

    const isMatch = await bcrypt.compare(password, admin.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid credentials." });
    }

    // Reset rate limit counter on successful login
    if (req._loginIp) loginAttempts.delete(req._loginIp);

    const token = jwt.sign(
      { username: admin.username, role: "admin" },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.json({
      success: true,
      message: "Login successful.",
      token,
      expiresIn: "24h",
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ success: false, message: "Server error during login." });
  }
});

// POST /api/auth/change-password (protected)
router.post("/change-password", authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "Both current and new password required." });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: "New password must be at least 8 characters." });
    }

    const admin = getAdmin();
    const isMatch = await bcrypt.compare(currentPassword, admin.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Current password is incorrect." });
    }

    adminStore.passwordHash = await bcrypt.hash(newPassword, 10);
    res.json({ success: true, message: "Password changed successfully." });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// GET /api/auth/verify (check if token is valid)
router.get("/verify", authMiddleware, (req, res) => {
  res.json({ success: true, admin: req.admin });
});

module.exports = router;
