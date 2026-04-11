const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const authMiddleware = require("../middleware/auth");

// In-memory admin store (replace with DB in production)
// Passwords stored as bcrypt hashes
let adminStore = null;

const getAdmin = () => {
  if (!adminStore) {
    adminStore = {
      username: process.env.ADMIN_USERNAME || "admin",
      // Default hash for "spicejar@admin123" - will be replaced on first setup
      passwordHash: bcrypt.hashSync(process.env.ADMIN_PASSWORD || "spicejar@admin123", 10),
    };
  }
  return adminStore;
};

// POST /api/auth/login
router.post("/login", async (req, res) => {
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
