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
// --- API ĐĂNG KÝ (Tạo mới) ---
app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, password, room, salt, certificate } = req.body;
    
    // Kiểm tra user tồn tại chưa
    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).json("Username đã tồn tại!");

    // Tạo user mới
    const newUser = new User({
      username,
      password, // Lưu ý: Thực tế nên dùng bcrypt để hash password này
      room,
      salt,
      certificate,
      encryptedVault: "",
      vaultIntegrity: ""
    });

    await newUser.save();
    res.status(200).json("Đăng ký thành công!");
  } catch (err) {
    res.status(500).json(err);
  }
});

// --- API ĐĂNG NHẬP (Kiểm tra & Lấy Salt) ---
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password, room } = req.body;

    // 1. Tìm user
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json("User không tồn tại!");

    // 2. Check Password đăng nhập
    if (user.password !== password) {
        return res.status(401).json("Sai mật khẩu đăng nhập!");
    }

    // 3. Check Room (Bắt buộc đúng room mới cho vào)
    if (user.room !== room) {
        return res.status(403).json(`User này thuộc phòng '${user.room}', không phải '${room}'!`);
    }

    // 4. Trả về Salt để Client tái tạo Master Key
    res.status(200).json({ 
        salt: user.salt,
        message: "Login OK"
    });
  } catch (err) {
    res.status(500).json(err);
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
    
    console.log("------------------------------------------------");
    console.log(`[DEBUG] Nhận yêu cầu lưu Vault cho user: ${username}`);
    console.log(`[DEBUG] Dữ liệu mã hóa nhận được:`, encryptedVault ? "Có dữ liệu" : "RỖNG!!!");

    // Tìm và update
    const updatedUser = await User.findOneAndUpdate(
      { username: username }, 
      { 
        $set: { 
            encryptedVault: encryptedVault,
            vaultIntegrity: vaultIntegrity
        }
      },
      { new: true }
    );

    if (!updatedUser) {
        console.error(`[LỖI] Không tìm thấy user "${username}" trong Database để update!`);
        return res.status(404).json("User not found");
    }

    console.log(`[THÀNH CÔNG] Đã update DB cho user: ${updatedUser.username}`);
    console.log("------------------------------------------------");
    
    res.status(200).json("Vault synced successfully");
  } catch (err) {
    console.error("[LỖI SERVER]", err);
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

// API Lấy Salt (Gọi khi bắt đầu đăng nhập)
app.get("/api/salt/:username", async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) return res.status(404).json("User not found");
    // Trả về salt (nếu chưa có thì trả về rỗng)
    res.status(200).json({ salt: user.salt || "" });
  } catch (err) {
    res.status(500).json(err);
  }
});

// API Lưu Salt (Gọi lần đầu tiên tạo tài khoản hoặc lần đầu dùng Vault)
app.post("/api/salt", async (req, res) => {
  try {
    const { username, salt } = req.body;
    await User.findOneAndUpdate(
      { username: username },
      { $set: { salt: salt } }
    );
    res.status(200).json("Salt saved");
  } catch (err) {
    res.status(500).json(err);
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