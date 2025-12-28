import React, { useState } from "react";
import { useHistory, Link } from "react-router-dom";
import { cryptoService } from "../crypto-core/CryptoService";
import "./home.scss"; // Tận dụng CSS cũ

function Register() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");       // Pass đăng nhập
  const [masterPass, setMasterPass] = useState("");   // Pass mã hóa
  const [room, setRoom] = useState("");
  const [loading, setLoading] = useState(false);
  const history = useHistory();

  const handleRegister = async () => {
    if (!username || !password || !masterPass || !room) {
        return alert("Vui lòng điền đủ thông tin!");
    }
    
    setLoading(true);
    try {
        console.log("⏳ Đang tạo khóa bảo mật...");
        // 1. Tạo Key & Salt mới (Master Password dùng ở đây)
        // init(username, password, existingSalt=null) -> Tạo salt mới
        const myCert = await cryptoService.init(username, masterPass);
        
        // Lấy salt vừa tạo ra để gửi lên server
        const generatedSalt = cryptoService.keychain.data.salt;

        // 2. Gọi API Đăng ký
        const res = await fetch("http://localhost:8000/api/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username,
                password, // Pass đăng nhập server
                room,
                salt: generatedSalt, // Salt để lưu lại
                certificate: myCert
            })
        });

        if (res.ok) {
            alert("Đăng ký thành công! Hãy đăng nhập.");
            history.push("/"); // Chuyển về trang Login
        } else {
            const text = await res.json();
            alert("Lỗi: " + text);
            setLoading(false)
        }
    } catch (err) {
        alert("Lỗi đăng ký: " + err.message);
        setLoading(false);
    }
    setLoading(false);
  };

  return (
    <div className="homepage">
      <h1>Register Secure Account</h1>
      <input placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
      <input placeholder="Room Name" value={room} onChange={e => setRoom(e.target.value)} />
      <input type="password" placeholder="Login Password" 
               value={password} onChange={e => setPassword(e.target.value)} />
        
        <input type="password" placeholder="Master Password" 
               value={masterPass} onChange={e => setMasterPass(e.target.value)} 
               />

      <button onClick={handleRegister} disabled={loading}>{loading ? "Creating..." : "Register"}</button>
      <p>Đã có tài khoản? <Link to="/" style={{color: "#4ade80"}}>Đăng nhập ngay</Link></p>
    </div>
  );
}

export default Register;