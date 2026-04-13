require("dotenv").config();

// ── STARTUP SAFETY CHECKS ──────────────────────────────────────
if (!process.env.JWT_SECRET) {
  console.error("❌ FATAL: JWT_SECRET environment variable is not set. Refusing to start.");
  process.exit(1);
}
if (!process.env.MONGODB_URI) {
  console.error("❌ FATAL: MONGODB_URI environment variable is not set. Refusing to start.");
  process.exit(1);
}

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");

const app = express();

// ── MIDDLEWARE ─────────────────────────────────────────────────
// Fixed: replaced overly broad /\.vercel\.app$/ regex with explicit allowed origins
const allowedOrigins = [
  process.env.FRONTEND_URL || "http://localhost:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. curl, mobile apps)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS: Origin ${origin} not allowed.`), false);
  },
  credentials: true,
}));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Serve uploaded images statically
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ── DATABASE ───────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
  })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection failed:", err.message));

// ── ROUTES ─────────────────────────────────────────────────────
app.use("/api/auth", require("./routes/auth"));
app.use("/api/products", require("./routes/products"));
app.use("/api/orders", require("./routes/orders"));

// Fixed: single /api/messages route (was duplicated and one had a syntax error)
app.post("/api/messages", (req, res) => {
  const { name, phone, message } = req.body;
  if (!name || !phone || !message) {
    return res.status(400).json({ success: false, message: "Name, phone, and message are required." });
  }
  console.log("📩 New Message:", name, phone, message);
  res.json({ success: true, message: "Message received." });
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Kerala Spice Jar API is running 🌶️",
    timestamp: new Date().toISOString(),
    dbStatus: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  });
});

// ── SEED DEMO DATA (dev only) ───────────────────────────────────
// Fixed: was an unclosed if-block at the bottom; now properly closed
if (process.env.NODE_ENV === "development") {
  app.post("/api/seed", async (req, res) => {
    try {
      const Product = require("./models/Product");
      await Product.deleteMany({});

      const demoProducts = [
        {
          name: "Mango Pickle (Avakaya)",
          shortDescription: "Tangy raw mango pickle with mustard & chilli",
          description: "Our signature Andhra-style raw mango pickle, slow-marinated with hand-ground mustard seeds, fiery red chillis, and cold-pressed sesame oil. Made in small batches to preserve every ounce of authentic flavour.",
          price: 180, originalPrice: 220, category: "Pickles",
          weight: "250g", isVeg: true, isFeatured: true, inStock: true,
          ingredients: "Raw Mango, Mustard Seeds, Red Chilli, Sesame Oil, Salt, Turmeric",
          shelfLife: "6 months", rating: 4.8, reviewCount: 124,
          tags: ["mango", "pickle", "spicy", "andhra"],
          image: "https://images.unsplash.com/photo-1601050690597-df0568f70950?w=400&q=80",
        },
        {
          name: "Kerala Fish Curry Masala",
          shortDescription: "Authentic Malabar fish curry spice blend",
          description: "A carefully balanced blend of sun-dried Kerala spices — Malabar pepper, kudam puli, coconut-roasted coriander, and hand-picked curry leaves. Just add coconut milk for the perfect fish curry.",
          price: 120, originalPrice: 150, category: "Spice Mixes",
          weight: "100g", isVeg: true, isFeatured: true, inStock: true,
          ingredients: "Coriander, Black Pepper, Turmeric, Dry Red Chilli, Kudam Puli, Curry Leaves, Coconut",
          shelfLife: "12 months", rating: 4.9, reviewCount: 89,
          tags: ["fish", "curry", "masala", "kerala", "malabar"],
          image: "https://images.unsplash.com/photo-1596797038530-2c107229654b?w=400&q=80",
        },
        {
          name: "Lime & Ginger Pickle",
          shortDescription: "Sun-kissed lime with fresh ginger & spices",
          description: "Hand-cut limes sun-dried for 7 days, packed with freshly grated ginger, ajwain, and a pinch of hing. A traditional digestive and flavour-bomb in every bite.",
          price: 150, category: "Pickles",
          weight: "250g", isVeg: true, isFeatured: false, inStock: true,
          ingredients: "Lime, Ginger, Ajwain, Asafoetida, Salt, Mustard Oil",
          shelfLife: "8 months", rating: 4.6, reviewCount: 56,
          tags: ["lime", "ginger", "pickle", "digestive"],
          image: "https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=400&q=80",
        },
        {
          name: "Coconut Chutney Powder",
          shortDescription: "Instant chutney powder — just add coconut oil",
          description: "A pantry essential. Toasted desiccated coconut, urad dal, dried red chilli, and curry leaves blended into a versatile powder. Perfect with idli, dosa, or rice.",
          price: 95, category: "Chutneys",
          weight: "150g", isVeg: true, isFeatured: true, inStock: true,
          ingredients: "Coconut, Urad Dal, Red Chilli, Curry Leaves, Salt, Asafoetida",
          shelfLife: "3 months", rating: 4.7, reviewCount: 200,
          tags: ["coconut", "chutney", "idli", "dosa", "instant"],
          image: "https://images.unsplash.com/photo-1589301760014-d929f3979dbc?w=400&q=80",
        },
        {
          name: "Banana Chips (Nendran)",
          shortDescription: "Crispy Nendran chips in coconut oil",
          description: "Made from premium Nendran bananas, sliced thin and fried in pure coconut oil with a sprinkle of rock salt. Kerala's beloved snack — crunchy, golden, and addictive.",
          price: 110, originalPrice: 130, category: "Snacks",
          weight: "200g", isVeg: true, isFeatured: true, inStock: true,
          ingredients: "Nendran Banana, Coconut Oil, Rock Salt, Turmeric",
          shelfLife: "45 days", rating: 4.9, reviewCount: 312,
          tags: ["banana", "chips", "nendran", "snack", "coconut oil"],
          image: "https://images.unsplash.com/photo-1621939514649-280e2ee25f60?w=400&q=80",
        },
        {
          name: "Sambar Powder",
          shortDescription: "Traditional Tamil-Kerala style sambar masala",
          description: "A robust, slow-roasted sambar powder using 18 spices including Bydagi chilli, black pepper, toor dal, and fresh curry leaves. Deep, smoky, and absolutely authentic.",
          price: 130, category: "Spice Mixes",
          weight: "200g", isVeg: true, isFeatured: false, inStock: true,
          ingredients: "Coriander, Cumin, Black Pepper, Chilli, Toor Dal, Curry Leaves, Mustard",
          shelfLife: "12 months", rating: 4.5, reviewCount: 78,
          tags: ["sambar", "masala", "south indian"],
          image: "https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=400&q=80",
        },
      ];

      await Product.insertMany(demoProducts);
      res.json({ success: true, message: `${demoProducts.length} demo products seeded.` });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });
}

// ── ERROR HANDLER ───────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.message);
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ success: false, message: "File too large. Max 5MB." });
  }
  res.status(err.status || 500).json({ success: false, message: err.message || "Internal server error." });
});

// ── START SERVER ────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🌶️  Kerala Spice Jar API running on port ${PORT}`);
  console.log(`🔗 Health: http://localhost:${PORT}/api/health`);
});
