import React, { useState } from "react";
import { BrowserRouter as Router, Switch, Route, useParams } from "react-router-dom";
import io from "socket.io-client";
import "./App.scss";
import Chat from "./chat/chat";
import Process from "./process/process";
import Home from "./home/home";
import PasswordVault from "./vault/PasswordVault"; 

// Kết nối Backend
const socket = io.connect("http://localhost:5000");

function ChatLayout({ socket }) {
  const { username, roomname } = useParams();
  const [activeTab, setActiveTab] = useState("chat");

  return (
    <div className="main-container" style={{ display: "flex", width: "100vw", height: "100vh", overflow: "hidden" }}>
      
      {/* 1. KHUNG CHÍNH (Chat & Vault) */}
      <div className="main-content" style={{ flex: 1, display: "flex", flexDirection: "column", background: "#252526" }}>
        
        {/* Menu Tabs */}
        <div className="nav-tabs" style={{ display: "flex", background: "#111", borderBottom: "1px solid #444", height: "50px", flexShrink: 0 }}>
          <button 
            onClick={() => setActiveTab("chat")}
            style={{
              flex: 1,
              background: activeTab === "chat" ? "#2d2d2d" : "transparent",
              color: activeTab === "chat" ? "#4ade80" : "#888",
              border: "none",
              borderBottom: activeTab === "chat" ? "3px solid #4ade80" : "none",
              cursor: "pointer",
              fontWeight: "bold",
              transition: "all 0.3s"
            }}
          >
            💬 SECURE CHAT
          </button>
          
          <button 
            onClick={() => setActiveTab("vault")}
            style={{
              flex: 1,
              background: activeTab === "vault" ? "#2d2d2d" : "transparent",
              color: activeTab === "vault" ? "#4ade80" : "#888",
              border: "none",
              borderBottom: activeTab === "vault" ? "3px solid #4ade80" : "none",
              cursor: "pointer",
              fontWeight: "bold",
              transition: "all 0.3s"
            }}
          >
            🔐 PASSWORD VAULT
          </button>
        </div>

        {/* NỘI DUNG (Dùng display: none thay vì if/else để giữ tin nhắn) */}
        <div className="tab-content" style={{ flex: 1, position: "relative", overflow: "hidden" }}>
            
            {/* CHAT TAB: Luôn render, chỉ ẩn hiện bằng CSS */}
            <div style={{ width: "100%", height: "100%", display: activeTab === "chat" ? "block" : "none" }}>
                <Chat username={username} roomname={roomname} socket={socket} />
            </div>

            {/* VAULT TAB: Luôn render, chỉ ẩn hiện bằng CSS */}
            <div style={{ width: "100%", height: "100%", display: activeTab === "vault" ? "block" : "none" }}>
                <PasswordVault username={username} />
            </div>

        </div>
      </div>

      {/* 2. KHUNG PROCESS LOG (Bên phải) */}
      <div className="sidebar-process" style={{ width: "25%", minWidth: "300px", borderLeft: "1px solid #444", background: "#1e1e1e" }}>
        <Process />
      </div>

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
          <Route path="/" exact>
            <Home socket={socket} />
          </Route>
        </Switch>
      </div>
    </Router>
  );
}

export default App;