const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const Product = require("../models/Product");
const authMiddleware = require("../middleware/auth");

// Multer config for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "../uploads");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `product_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
    cb(null, name);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error("Only JPEG, PNG, WebP, and GIF images allowed."), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// ── PUBLIC ROUTES ──────────────────────────────────────────────

// GET /api/products — fetch all products (with search, filter, sort)
router.get("/", async (req, res) => {
  try {
    const {
      search,
      category,
      inStock,
      featured,
      minPrice,
      maxPrice,
      sort = "createdAt",
      order = "desc",
      page = 1,
      limit = 20,
    } = req.query;

    const query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { tags: { $in: [new RegExp(search, "i")] } },
      ];
    }

    if (category) query.category = category;
    if (inStock !== undefined) query.inStock = inStock === "true";
    if (featured === "true") query.isFeatured = true;
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = Number(minPrice);
      if (maxPrice) query.price.$lte = Number(maxPrice);
    }

    const sortObj = { [sort]: order === "asc" ? 1 : -1 };
    const skip = (Number(page) - 1) * Number(limit);

    const [products, total] = await Promise.all([
      Product.find(query).sort(sortObj).skip(skip).limit(Number(limit)),
      Product.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: products,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (err) {
    console.error("Fetch products error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch products." });
  }
});

// GET /api/products/categories — get all categories with counts
router.get("/categories", async (req, res) => {
  try {
    const categories = await Product.aggregate([
      { $group: { _id: "$category", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    res.json({ success: true, data: categories });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch categories." });
  }
});

// GET /api/products/:id — fetch single product
router.get("/:id", async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: "Product not found." });
    res.json({ success: true, data: product });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch product." });
  }
});

// ── ADMIN ROUTES (Protected) ────────────────────────────────────

// POST /api/products — create product
router.post("/", authMiddleware, upload.array("images", 5), async (req, res) => {
  try {
    const {
      name, description, shortDescription, price, originalPrice,
      category, inStock, stockQuantity, weight, ingredients,
      shelfLife, isVeg, isFeatured, tags,
    } = req.body;

    const imageUrls = req.files?.map(
      (f) => `/uploads/${f.filename}`
    ) || [];

    const product = new Product({
      name, description, shortDescription,
      price: Number(price),
      originalPrice: originalPrice ? Number(originalPrice) : undefined,
      category,
      inStock: inStock !== "false",
      stockQuantity: Number(stockQuantity) || 100,
      weight, ingredients, shelfLife,
      isVeg: isVeg !== "false",
      isFeatured: isFeatured === "true",
      tags: tags ? tags.split(",").map((t) => t.trim()) : [],
      image: imageUrls[0] || "",
      images: imageUrls,
    });

    await product.save();
    res.status(201).json({ success: true, message: "Product created.", data: product });
  } catch (err) {
    console.error("Create product error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to create product." });
  }
});

// PUT /api/products/:id — update product
router.put("/:id", authMiddleware, upload.array("images", 5), async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: "Product not found." });

    const fields = [
      "name", "description", "shortDescription", "category",
      "weight", "ingredients", "shelfLife",
    ];
    fields.forEach((f) => { if (req.body[f] !== undefined) product[f] = req.body[f]; });

    if (req.body.price !== undefined) product.price = Number(req.body.price);
    if (req.body.originalPrice !== undefined) product.originalPrice = Number(req.body.originalPrice);
    if (req.body.inStock !== undefined) product.inStock = req.body.inStock !== "false";
    if (req.body.isVeg !== undefined) product.isVeg = req.body.isVeg !== "false";
    if (req.body.isFeatured !== undefined) product.isFeatured = req.body.isFeatured === "true";
    if (req.body.stockQuantity !== undefined) product.stockQuantity = Number(req.body.stockQuantity);
    if (req.body.tags) product.tags = req.body.tags.split(",").map((t) => t.trim());

    if (req.files?.length > 0) {
      const newImages = req.files.map((f) => `/uploads/${f.filename}`);
      product.images = [...(product.images || []), ...newImages];
      if (!product.image) product.image = newImages[0];
    }

    await product.save();
    res.json({ success: true, message: "Product updated.", data: product });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to update product." });
  }
});

// PATCH /api/products/:id/stock — toggle stock
router.patch("/:id/stock", authMiddleware, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: "Product not found." });

    product.inStock = req.body.inStock !== undefined ? req.body.inStock : !product.inStock;
    await product.save();
    res.json({ success: true, message: `Stock status updated to ${product.inStock ? "In Stock" : "Out of Stock"}.`, data: product });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to update stock." });
  }
});

// DELETE /api/products/:id
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: "Product not found." });

    // Remove associated image files
    (product.images || []).forEach((imgPath) => {
      const fullPath = path.join(__dirname, "..", imgPath);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    });

    res.json({ success: true, message: "Product deleted." });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to delete product." });
  }
});

module.exports = router;
