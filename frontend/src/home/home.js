import React, { useState } from "react";
import "./home.scss";
// 1. Thay Link bằng useHistory (để chuyển trang sau khi code chạy xong)
import { useHistory } from "react-router-dom"; 
import { cryptoService } from "../crypto-core/CryptoService";

function Home({ socket }) {
  const [username, setusername] = useState("");
  const [roomname, setroomname] = useState("");
  const [password, setPassword] = useState(""); 
  const [loading, setLoading] = useState(false);
  
  // 2. Khai báo history
  const history = useHistory(); 

  const sendData = async () => {
    if (username !== "" && roomname !== "" && password !== "") {
      setLoading(true);
      try {
        console.log("Initializing Security Layer...");
        
        // 3. KHỞI TẠO HỆ THỐNG MẬT MÃ
        // Tạo Két sắt (Project 1) và Identity Key (Project 2)
        const myCert = await cryptoService.init(username, password);
        console.log("Crypto Ready! Identity:", myCert);
        
        // 4. GỬI PUBLIC KEY LÊN SERVER (Quan trọng cho Project 2)
        // Bước này giúp người khác tìm thấy bạn để chat mã hóa
        await fetch("http://localhost:5000/api/register", {
             method: "POST",
             headers: {"Content-Type": "application/json"},
             body: JSON.stringify({ 
                 username, 
                 certificate: myCert,
                 encryptedVault: "", // Gửi két sắt rỗng ban đầu
                 vaultIntegrity: "" 
             })
        });

        // 5. Sau khi xong hết mới Join phòng
        socket.emit("joinRoom", { username, roomname });
        
        setLoading(false);

        // 6. CHUYỂN TRANG BẰNG CODE
        // Thay thế cho việc dùng thẻ <Link>
        history.push(`/chat/${username}/${roomname}`);
        
      } catch (err) {
        alert("Lỗi khởi tạo bảo mật: " + err.message);
        setLoading(false);
      }
    } else {
      alert("Vui lòng nhập đầy đủ Username, Room và Password!");
    }
  };

  return (
    <div className="homepage">
      <h1>
        SecureChat <span style={{fontSize: "1rem", color: "lime"}}>E2EE</span>
      </h1>
      
      <input
        placeholder="Username"
        value={username}
        onChange={(e) => setusername(e.target.value)}
      ></input>
      
      <input
        placeholder="Room Name"
        value={roomname}
        onChange={(e) => setroomname(e.target.value)}
      ></input>

      {/* Ô nhập Master Password */}
      <input
        type="password"
        placeholder="Master Password (cho Vault & Keys)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={{border: "2px solid #4ade80"}}
      ></input>

      {/* Nút Join: Bỏ thẻ Link, chỉ dùng Button với onClick */}
      <button onClick={sendData} disabled={loading}>
          {loading ? "Initializing Keys..." : "Secure Join"}
      </button>
      
      <p style={{marginTop: "10px", fontSize: "0.8rem", color: "#aaa"}}>
        *Master Password được dùng để sinh khóa PBKDF2 (Project 1)
      </p>
    </div>
  );
}

export default Home;