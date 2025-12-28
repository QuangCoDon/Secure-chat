import { useState } from "react";
import { BrowserRouter as Router, Switch, Route, useParams } from "react-router-dom";
import io from "socket.io-client";
import "./App.scss";
import Chat from "./chat/chat";
import Home from "./home/home";
import PasswordVault from "./vault/PasswordVault"; 
import Register from "./home/Register";

// Kết nối Backend
const socket = io.connect("http://localhost:8000");

function ChatLayout({ socket }) {
  const { username, roomname } = useParams();
  const [activeTab, setActiveTab] = useState("chat"); 
  // Hàm xử lý Đăng xuất
  const handleLogout = () => {
    // 1. Có thể gửi sự kiện logout lên server nếu cần
    // socket.emit("logout", { username });

    // 2. QUAN TRỌNG: Dùng reload để XÓA SẠCH RAM (Key, Password)
    // Nếu dùng history.push, biến global vẫn còn, hacker có thể back lại xem được.
    window.location.href = "/";
  };

  return (
    <div className="main-container">
      
      {/* 1. KHUNG CHÍNH (Chat & Vault) */}
      <div className="main-content">
        
        {/* THANH MENU (NAVIGATION) */}
        <div className="nav-tabs">
          {/* Nhóm nút chuyển Tab */}
          <div className="tabs-group">
            <button 
              className={activeTab === "chat" ? "active" : ""}
              onClick={() => setActiveTab("chat")}
            >
              💬 SECURE CHAT
            </button>
            
            <button 
              className={activeTab === "vault" ? "active" : ""}
              onClick={() => setActiveTab("vault")}
            >
              🔐 PASSWORD VAULT
            </button>
          </div>

          {/* Nút Logout nằm riêng bên phải */}
          <button className="logout-btn" onClick={handleLogout}>
            LOGOUT ➔
          </button>
        </div>

        {/* NỘI DUNG CHÍNH */}
        <div className="tab-content">
            {/* CHAT TAB */}
            <div className={`tab-pane ${activeTab === "chat" ? "show" : ""}`}>
                <Chat username={username} roomname={roomname} socket={socket} />
            </div>

            {/* VAULT TAB */}
            <div className={`tab-pane ${activeTab === "vault" ? "show" : ""}`}>
                <PasswordVault username={username} />
            </div>
        </div>
      </div>

      {/* 2. KHUNG PROCESS LOG (Bên phải)
      <div className="sidebar-process">
        <Process />
      </div> */}

    </div>
  );
}

function App() {
  return (
    <Router>
      <div className="App">
        <Switch>
          <Route path="/chat/:username/:roomname">
            <ChatLayout socket={socket} />
          </Route>
          <Route path="/register" exact>
             <Register />
          </Route>
          <Route path="/" exact>
            <Home socket={socket} />
          </Route>
        </Switch>
      </div>
    </Router>
  );
}

export default App;