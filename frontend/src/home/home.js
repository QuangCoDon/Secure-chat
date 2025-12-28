import React, { useState } from "react";
import { useHistory, Link } from "react-router-dom";
import { cryptoService } from "../crypto-core/CryptoService";
import "./home.scss";

function Home({ socket }) {
  const [username, setUsername] = useState("");
  const [room, setRoom] = useState("");
  const [password, setPassword] = useState("");     // Pass Login
  const [masterPass, setMasterPass] = useState(""); // Pass Crypto
  const [loading, setLoading] = useState(false);
  
  const history = useHistory();

  const handleLogin = async () => {
    if (!username || !password || !masterPass || !room) {
        return alert("Điền đủ thông tin!");
    }

    setLoading(true);
    try {
        // 1. Gọi API Login để xác thực & lấy Salt
        const res = await fetch("http://localhost:8000/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password, room })
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err);
        }

        const data = await res.json();
        const serverSalt = data.salt; // Salt chuẩn từ server

        console.log("✅ Login Server OK. Salt:", serverSalt);

        // 2. Khởi tạo Crypto với Salt lấy từ Server
        // init sẽ tạo lại đúng bộ khóa cũ nhờ salt này
        const myNewCert = await cryptoService.init(username, masterPass, serverSalt);
        
        // Kiểm tra xem Salt tạo ra có khớp không (logic trong Keychain.init đã xử lý)
        // Nếu Master Password sai -> Key sai -> Sau này giải mã sẽ lỗi (DOMException)
        console.log("🔄 Đang cập nhật Certificate mới lên Server...");
        await fetch("http://localhost:8000/api/register", { // Tái sử dụng API register để update
             method: "POST",
             headers: {"Content-Type": "application/json"},
             body: JSON.stringify({ 
                 username, 
                 certificate: myNewCert
                 // KHÔNG gửi encryptedVault để tránh ghi đè dữ liệu cũ
             })
        });
        // 3. Join Socket
        socket.emit("joinRoom", { username, roomname: room });

        // 4. Vào Chat
        history.push(`/chat/${username}/${room}`);

    } catch (err) {
        alert("Đăng nhập thất bại: " + err.message);
        setLoading(false); 
    }
  };

  return (
    <div className="homepage">
      <h1>SecureChat Login</h1>
      
      <input placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
      <input placeholder="Room Name" value={room} onChange={e => setRoom(e.target.value)} />
      <input type="password" placeholder="Login Password" 
        value={password} onChange={e => setPassword(e.target.value)} />
      <input type="password" placeholder="Master Password" 
        value={masterPass} onChange={e => setMasterPass(e.target.value)} />


      <button onClick={handleLogin} disabled={loading}>{loading ? "Verifying..." : "Login"}</button>
      
      <p>Chưa có tài khoản? <Link to="/register" style={{color: "#4ade80"}}>Đăng ký</Link></p>
    </div>
  );
}

export default Home;