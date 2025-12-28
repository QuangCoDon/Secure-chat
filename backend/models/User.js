// backend/models/User.js
const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
  },
  password: { type: String, required: true }, // Mật khẩu đăng nhập (nên hash, nhưng demo lưu text cũng được)
  room: { type: String, required: true },     // User thuộc phòng nào
  // --- DÀNH CHO PROJECT 1 (PASSWORD MANAGER) ---
  // Lưu chuỗi JSON đã mã hóa của Két sắt
  encryptedVault: {
    type: String,
    default: "",
  },
  // Lưu mã băm SHA-256 để kiểm tra toàn vẹn (Chống Rollback)
  vaultIntegrity: {
    type: String,
    default: "",
  },
  // --- DÀNH CHO PROJECT 2 (SECURE CHAT) ---
  // Lưu Public Key (Identity Key) để người khác tìm thấy và thiết lập mã hóa
  certificate: {
    type: Object, 
    default: {},
  },
  salt: { 
    type: String,
    default: "",
  }
});

module.exports = mongoose.model("User", UserSchema);