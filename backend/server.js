require("dotenv").config();
const express = require("express");
const app = express();
const socket = require("socket.io");
const color = require("colors");
const cors = require("cors");
const mongoose = require("mongoose");

// Import Model User vừa tạo
const User = require("./models/User");

// --- THAY ĐỔI 1: Tăng giới hạn body parser ---
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use(cors());

const port = process.env.PORT || 8000;

// --- 1. KẾT NỐI MONGODB ---
mongoose
  .connect(process.env.MONGO_URL)
  .then(() => console.log("--> DB Connection Successful".green))
  .catch((err) => console.log("--> DB Connection Error: ".red, err));

// --- 2. CÁC API REST ---

app.post("/api/register", async (req, res) => {
  const { username, certificate, encryptedVault, vaultIntegrity } = req.body;
  try {
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

app.get("/api/certificate/:username", async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) return res.status(404).json({ msg: "User not found" });
    res.status(200).json(user.certificate);
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

app.post("/api/vault", async (req, res) => {
  try {
    const { username, encryptedVault, vaultIntegrity } = req.body;
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
// --- THAY ĐỔI 2: Thêm maxHttpBufferSize ---
const io = socket(server, {
  maxHttpBufferSize: 1e8, // Cho phép gói tin lên tới 100MB
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

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

    socket.emit("message", { userId: "admin", username: "System", text: `Welcome ${username}` });
    socket.broadcast.to(roomname).emit("message", { userId: "admin", username: "System", text: `${username} joined` });

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

  socket.on("chat", (payload) => {
    const user = onlineUsers.get(socket.id);
    if (user) {
      io.to(user.room).emit("message", {
        userId: socket.id,
        username: user.username,
        content: payload, 
      });
    }
  });

  socket.on("disconnect", () => {
    const user = onlineUsers.get(socket.id);
    if (user) {
      io.to(user.room).emit("message", { userId: "admin", username: "System", text: `${user.username} left` });
      onlineUsers.delete(socket.id);

      const usersInRoom = getRoomUsers(user.room);
      io.to(user.room).emit("roomUsers", {
        room: user.room,
        users: usersInRoom
      });
    }
  });
});