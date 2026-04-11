const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
      maxlength: [100, "Name cannot exceed 100 characters"],
    },
    description: {
      type: String,
      required: [true, "Product description is required"],
      trim: true,
      maxlength: [1000, "Description cannot exceed 1000 characters"],
    },
    shortDescription: {
      type: String,
      trim: true,
      maxlength: [200, "Short description cannot exceed 200 characters"],
    },
    price: {
      type: Number,
      required: [true, "Price is required"],
      min: [0, "Price cannot be negative"],
    },
    originalPrice: {
      type: Number,
      min: [0, "Original price cannot be negative"],
    },
    category: {
      type: String,
      required: [true, "Category is required"],
      enum: ["Pickles", "Spice Mixes", "Chutneys", "Snacks", "Sweets", "Beverages", "Other"],
      default: "Other",
    },
    image: {
      type: String,
      default: "",
    },
    images: [String],
    inStock: {
      type: Boolean,
      default: true,
    },
    stockQuantity: {
      type: Number,
      default: 100,
      min: 0,
    },
    weight: {
      type: String,
      default: "250g",
    },
    ingredients: {
      type: String,
      trim: true,
    },
    shelfLife: {
      type: String,
      default: "6 months",
    },
    isVeg: {
      type: Boolean,
      default: true,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    tags: [String],
    rating: {
      type: Number,
      default: 4.5,
      min: 0,
      max: 5,
    },
    reviewCount: {
      type: Number,
      default: 0,
    },
    soldCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Text index for search
productSchema.index({ name: "text", description: "text", tags: "text" });

module.exports = mongoose.model("Product", productSchema);
