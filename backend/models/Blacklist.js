const mongoose = require("mongoose");

const blacklistSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  reason: { type: String }, // Reason for blacklisting (e.g., fraud, poor reviews)
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Blacklist", blacklistSchema);