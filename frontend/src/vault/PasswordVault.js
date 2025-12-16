import React, { useState, useEffect } from "react";
import { cryptoService } from "../crypto-core/CryptoService";
import "./vault.scss"; 
function PasswordVault({ username }) {
  const [passwords, setPasswords] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // Form thêm mới
  const [site, setSite] = useState("");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");

  // 1. Load và Giải mã dữ liệu khi mở Tab này
  useEffect(() => {
    loadVault();
  }, []);

  const loadVault = async () => {
    setLoading(true);
    try {
      // Gọi API lấy chuỗi mã hóa
      const res = await fetch(`http://localhost:5000/api/vault/${username}`);
      const data = await res.json();

      if (data.encryptedVault) {
        // --- QUAN TRỌNG: Dùng Keychain để giải mã ---
        // Giả sử cryptoService.keychain có hàm load(ciphertext, integrity)
        // Bạn cần đảm bảo class Keychain trong password-manager.js có hàm này
        const decryptedList = await cryptoService.keychain.load(
            data.encryptedVault, 
            data.vaultIntegrity
        );
        setPasswords(decryptedList); // List này là JSON gốc (plaintext)
      }
    } catch (err) {
      console.error("Lỗi tải Vault:", err);
      alert("Không thể giải mã hoặc dữ liệu bị can thiệp!");
    }
    setLoading(false);
  };

  // 2. Lưu và Mã hóa dữ liệu
  const saveVault = async (newList) => {
    try {
      // --- QUAN TRỌNG: Dùng Keychain để mã hóa ---
      // Hàm dump() sẽ trả về { encryptedVault, vaultIntegrity }
      const { encryptedVault, vaultIntegrity } = await cryptoService.keychain.dump(newList);

      // Gửi lên Server
      await fetch("http://localhost:5000/api/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          encryptedVault,
          vaultIntegrity
        }),
      });
      alert("Đã đồng bộ an toàn lên Server!");
    } catch (err) {
      console.error("Lỗi lưu Vault:", err);
    }
  };

  const handleAdd = () => {
    if (!site || !pass) return;
    const newItem = { site, user, pass, id: Date.now() };
    const newList = [...passwords, newItem];
    
    setPasswords(newList);
    setSite(""); setUser(""); setPass(""); // Reset form
    
    // Tự động lưu luôn
    saveVault(newList);
  };

  return (
    <div className="password-vault">
      <h2>🔐 Secure Password Vault</h2>
      
      {/* Form Thêm Mới - Sử dụng class .vault-form */}
      <div className="vault-form">
        <input 
            placeholder="Website (vd: facebook.com)" 
            value={site} 
            onChange={e=>setSite(e.target.value)} 
        />
        <input 
            placeholder="Username" 
            value={user} 
            onChange={e=>setUser(e.target.value)} 
        />
        <input 
            placeholder="Password" 
            type="text" 
            value={pass} 
            onChange={e=>setPass(e.target.value)} 
        />
        <button onClick={handleAdd}>ADD</button>
      </div>

      {/* Danh sách hiển thị - Sử dụng class .vault-list */}
      {loading ? <p style={{textAlign: "center"}}>Decrypting data from Vault...</p> : (
        <div className="vault-list">
          {passwords.map((item) => (
            <div key={item.id} className="vault-item">
              <div className="info">
                <span className="site">{item.site}</span>
                <span className="username">{item.user}</span>
              </div>
              <div className="pass-display">
                {item.pass}
              </div>
            </div>
          ))}
          
          {passwords.length === 0 && (
            <div className="empty-msg">Két sắt đang trống. Hãy thêm mật khẩu đầu tiên!</div>
          )}
        </div>
      )}
    </div>
  );
}

export default PasswordVault;