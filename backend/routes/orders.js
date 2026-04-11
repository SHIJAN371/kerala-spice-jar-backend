const express = require("express");
const router = express.Router();
const Order = require("../models/Order");
const Product = require("../models/Product");
const authMiddleware = require("../middleware/auth");

// ── PUBLIC ROUTES ──────────────────────────────────────────────

// POST /api/orders — create a new order
router.post("/", async (req, res) => {
  try {
    const { customer, items, paymentMethod, notes, source } = req.body;

    if (!customer?.name || !customer?.phone) {
      return res.status(400).json({ success: false, message: "Customer name and phone are required." });
    }
    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: "Order must have at least one item." });
    }

    // Validate and price items from DB
    let subtotal = 0;
    const enrichedItems = [];

    for (const item of items) {
      const product = await Product.findById(item.productId);
      if (!product) {
        return res.status(404).json({ success: false, message: `Product ${item.productId} not found.` });
      }
      if (!product.inStock) {
        return res.status(400).json({ success: false, message: `${product.name} is out of stock.` });
      }

      const itemSubtotal = product.price * item.quantity;
      subtotal += itemSubtotal;

      enrichedItems.push({
        product: product._id,
        productName: product.name,
        productImage: product.image,
        quantity: item.quantity,
        price: product.price,
        subtotal: itemSubtotal,
      });
    }

    const deliveryCharge = subtotal >= 500 ? 0 : 50;
    const total = subtotal + deliveryCharge;

    const order = new Order({
      customer,
      items: enrichedItems,
      subtotal,
      deliveryCharge,
      total,
      paymentMethod: paymentMethod || "WhatsApp",
      notes,
      source: source || "Website",
      statusHistory: [{ status: "Pending", note: "Order placed" }],
    });

    await order.save();

    // Increment soldCount for each product
    for (const item of enrichedItems) {
      await Product.findByIdAndUpdate(item.product, {
        $inc: { soldCount: item.quantity },
      });
    }

    res.status(201).json({
      success: true,
      message: "Order placed successfully!",
      data: {
        orderId: order.orderId,
        total: order.total,
        _id: order._id,
      },
    });
  } catch (err) {
    console.error("Create order error:", err);
    res.status(500).json({ success: false, message: "Failed to place order." });
  }
});

// GET /api/orders/track/:orderId — public order tracking
router.get("/track/:orderId", async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.orderId })
      .select("orderId status customer.name items total createdAt statusHistory");
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to track order." });
  }
});

// ── ADMIN ROUTES (Protected) ────────────────────────────────────

// GET /api/orders — list all orders
router.get("/", authMiddleware, async (req, res) => {
  try {
    const {
      status,
      paymentStatus,
      paymentMethod,
      source,
      search,
      from,
      to,
      sort = "createdAt",
      order = "desc",
      page = 1,
      limit = 25,
    } = req.query;

    const query = {};
    if (status) query.status = status;
    if (paymentStatus) query.paymentStatus = paymentStatus;
    if (paymentMethod) query.paymentMethod = paymentMethod;
    if (source) query.source = source;

    if (search) {
      query.$or = [
        { orderId: { $regex: search, $options: "i" } },
        { "customer.name": { $regex: search, $options: "i" } },
        { "customer.phone": { $regex: search, $options: "i" } },
      ];
    }

    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to) query.createdAt.$lte = new Date(new Date(to).setHours(23, 59, 59));
    }

    const sortObj = { [sort]: order === "asc" ? 1 : -1 };
    const skip = (Number(page) - 1) * Number(limit);

    const [orders, total] = await Promise.all([
      Order.find(query).sort(sortObj).skip(skip).limit(Number(limit)),
      Order.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: orders,
      pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch orders." });
  }
});

// GET /api/orders/analytics — dashboard stats
router.get("/analytics", authMiddleware, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const [
      totalOrders, todayOrders, monthOrders,
      revenueAgg, todayRevenueAgg, monthRevenueAgg,
      statusCounts, topProducts,
    ] = await Promise.all([
      Order.countDocuments(),
      Order.countDocuments({ createdAt: { $gte: today } }),
      Order.countDocuments({ createdAt: { $gte: thisMonth } }),
      Order.aggregate([{ $match: { status: { $ne: "Cancelled" } } }, { $group: { _id: null, total: { $sum: "$total" } } }]),
      Order.aggregate([{ $match: { createdAt: { $gte: today }, status: { $ne: "Cancelled" } } }, { $group: { _id: null, total: { $sum: "$total" } } }]),
      Order.aggregate([{ $match: { createdAt: { $gte: thisMonth }, status: { $ne: "Cancelled" } } }, { $group: { _id: null, total: { $sum: "$total" } } }]),
      Order.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      Order.aggregate([
        { $unwind: "$items" },
        { $group: { _id: "$items.productName", count: { $sum: "$items.quantity" }, revenue: { $sum: "$items.subtotal" } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]),
    ]);

    // Revenue trend (last 7 days)
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      const agg = await Order.aggregate([
        { $match: { createdAt: { $gte: d, $lt: next }, status: { $ne: "Cancelled" } } },
        { $group: { _id: null, revenue: { $sum: "$total" }, orders: { $sum: 1 } } },
      ]);
      last7Days.push({
        date: d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric" }),
        revenue: agg[0]?.revenue || 0,
        orders: agg[0]?.orders || 0,
      });
    }

    res.json({
      success: true,
      data: {
        totalOrders,
        todayOrders,
        monthOrders,
        totalRevenue: revenueAgg[0]?.total || 0,
        todayRevenue: todayRevenueAgg[0]?.total || 0,
        monthRevenue: monthRevenueAgg[0]?.total || 0,
        statusBreakdown: statusCounts,
        topProducts,
        revenueTrend: last7Days,
      },
    });
  } catch (err) {
    console.error("Analytics error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch analytics." });
  }
});

// GET /api/orders/:id
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch order." });
  }
});

// PATCH /api/orders/:id/status — update order status
router.patch("/:id/status", authMiddleware, async (req, res) => {
  try {
    const { status, note, paymentStatus } = req.body;
    const validStatuses = ["Pending", "Confirmed", "Processing", "Shipped", "Delivered", "Cancelled"];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status." });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });

    order.status = status;
    if (paymentStatus) order.paymentStatus = paymentStatus;
    order.statusHistory.push({ status, note: note || `Status updated to ${status}` });

    await order.save();
    res.json({ success: true, message: "Order status updated.", data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to update status." });
  }
});

// DELETE /api/orders/:id
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });
    res.json({ success: true, message: "Order deleted." });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to delete order." });
  }
});

module.exports = router;
