const mongoose = require("mongoose");

const adminSchema = new mongoose.Schema({
  fullname: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: "admin" }, // Optional future role-based control
  isSuperAdmin: { type: Boolean, default: false }, // Only super admins can manage other admins
  createdAt: { type: Date, default: Date.now },
});
module.exports = mongoose.model("Admin", adminSchema);