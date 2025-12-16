require("dotenv").config();
const express = require("express");
const app = express();
const socket = require("socket.io");
const color = require("colors");
const cors = require("cors");
const mongoose = require("mongoose");

// Import Model User vừa tạo
const User = require("./models/User");

// Middleware quan trọng để đọc JSON từ body request
app.use(express.json());
app.use(cors());

const port = process.env.PORT || 8000;

// --- 1. KẾT NỐI MONGODB ---
mongoose
  .connect(process.env.MONGO_URL)
  .then(() => console.log("--> DB Connection Successful".green))
  .catch((err) => console.log("--> DB Connection Error: ".red, err));

// --- 2. CÁC API REST (Phục vụ Project 1 & 2) ---

// API: Đăng ký User mới & Lưu Key ban đầu
app.post("/api/register", async (req, res) => {
  const { username, certificate, encryptedVault, vaultIntegrity } = req.body;
  try {
    // Tìm user, nếu chưa có thì tạo mới, có rồi thì update (upsert)
    await User.findOneAndUpdate(
      { username },
      { certificate, encryptedVault, vaultIntegrity },
      { upsert: true, new: true }
    );
    res.status(200).json({ msg: "User registered/updated successfully" });
  } catch (err) {
    res.status(500).json({ msg: "Error registering user" });
  }
});

// API: Lấy Certificate của người khác (Để bắt đầu chat Project 2)
app.get("/api/certificate/:username", async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) return res.status(404).json({ msg: "User not found" });
    res.status(200).json(user.certificate);
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

// API: Lưu lại Két sắt (Project 1)
app.post("/api/vault", async (req, res) => {
  try {
    const { username, encryptedVault, vaultIntegrity } = req.body;
    
    // Tìm và update
    await User.findOneAndUpdate(
      { username: username },
      { 
        encryptedVault: encryptedVault,
        vaultIntegrity: vaultIntegrity
      }
    );
    res.status(200).json("Vault synced successfully");
  } catch (err) {
    res.status(500).json(err);
  }
});

// API: Tải Két sắt về (Project 1)
app.get("/api/vault/:username", async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) return res.status(404).json({ msg: "User not found" });
    res.status(200).json({
      encryptedVault: user.encryptedVault,
      vaultIntegrity: user.vaultIntegrity,
    });
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

// --- 3. KHỞI CHẠY SERVER ---
var server = app.listen(
  port,
  console.log(`Server is running on the port no: ${port} `.green)
);

// --- 4. SOCKET.IO (XỬ LÝ CHAT REALTIME) ---
const io = socket(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Thay thế dummyuser.js bằng một Map trong bộ nhớ để quản lý user online
// Key: socket.id, Value: { username, room }
let onlineUsers = new Map();
function getRoomUsers(room) {
  const users = [];
  for (let [id, user] of onlineUsers) {
    if (user.room === room) {
      users.push(user.username);
    }
  }
  return users;
}
io.on("connection", (socket) => {
  socket.on("joinRoom", ({ username, roomname }) => {
    onlineUsers.set(socket.id, { username, room: roomname });
    socket.join(roomname);

    // Gửi tin nhắn chào mừng (Giữ nguyên)
    socket.emit("message", { userId: "admin", username: "System", text: `Welcome ${username}` });
    socket.broadcast.to(roomname).emit("message", { userId: "admin", username: "System", text: `${username} joined` });

    // --- MỚI: Gửi danh sách user trong phòng cho TẤT CẢ mọi người ---
    const usersInRoom = getRoomUsers(roomname);
    io.to(roomname).emit("roomUsers", {
      room: roomname,
      users: usersInRoom 
    });

    socket.broadcast.to(roomname).emit("message", {
      userId: "admin",
      username: "System",
      text: `${username} has joined the chat`,
    });
  });

  // Khi user gửi tin nhắn (QUAN TRỌNG: Xử lý gói tin mã hóa)
  socket.on("chat", (payload) => {
    // payload bây giờ là Object { header: {...}, ciphertext: "..." }
    const user = onlineUsers.get(socket.id);

    if (user) {
      // Server chỉ chuyển tiếp (forward), không đọc được nội dung
      io.to(user.room).emit("message", {
        userId: socket.id,
        username: user.username,
        content: payload, // Gửi nguyên object mã hóa về cho Client
      });
    }
  });

  // Khi user thoát
  socket.on("disconnect", () => {
    const user = onlineUsers.get(socket.id);
    if (user) {
      io.to(user.room).emit("message", { userId: "admin", username: "System", text: `${user.username} left` });
      onlineUsers.delete(socket.id);

      // --- MỚI: Cập nhật lại danh sách user cho người ở lại ---
      const usersInRoom = getRoomUsers(user.room);
      io.to(user.room).emit("roomUsers", {
        room: user.room,
        users: usersInRoom
      });
    }
  });
});