import { useSelector } from "react-redux";
import "./process.scss";

function Process() {
  // Lấy state từ Redux
  const state = useSelector((state) => state.ProcessReducer);

  return (
    <div className="process">
      <h5>
        Security Protocol: <span style={{color: "#4ade80"}}>Double Ratchet + AES-GCM</span>
      </h5>
      
      <div className="incoming">
        <h4>Encrypted Payload (Project 2)</h4>
        {/* Hiển thị JSON Header và Ciphertext */}
        <p style={{ 
            fontSize: "0.7rem", 
            wordBreak: "break-all", 
            fontFamily: "monospace",
            maxHeight: "200px",
            overflowY: "auto"
        }}>
            {state.cypher ? state.cypher : "Waiting for message..."}
        </p>
      </div>

      <div className="crypt">
        <h4>Decrypted Content</h4>
        <p>{state.text ? state.text : "..."}</p>
      </div>
      
      {/* Thêm phần hiển thị trạng thái Két sắt (Project 1) nếu muốn */}
      <div className="incoming" style={{marginTop: "20px", borderTop: "1px solid #555"}}>
        <h4>Vault Status</h4>
        <p style={{color: "yellow"}}>Data at Rest Encrypted</p>
      </div>
    </div>
  );
}
export default Process;