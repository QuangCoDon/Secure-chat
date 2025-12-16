import "./chat.scss";
import { cryptoService } from "../crypto-core/CryptoService";
import { process } from "../store/action/index";
import { useState, useEffect, useRef } from "react";
import { useDispatch } from "react-redux";

const formatForDisplay = (obj) => {
  return JSON.stringify(obj, null, 2);
};

function Chat({ username, roomname, socket }) {
  const [text, setText] = useState("");
  const [messages, setMessages] = useState([]);
  const [roomUsers, setRoomUsers] = useState([]); 
  const dispatch = useDispatch();
  
  // REF ĐỂ CUỘN: Trỏ vào container chứa tin nhắn
  const chatContainerRef = useRef(null);

  const dispatchProcess = (encrypt, msg, cipher) => {
    dispatch(process(encrypt, msg, cipher));
  };

  // --- HÀM CUỘN MỚI (MƯỢT HƠN) ---
  const scrollToBottom = () => {
    if (chatContainerRef.current) {
      const { scrollHeight, clientHeight } = chatContainerRef.current;
      // Đặt vị trí cuộn xuống đáy
      chatContainerRef.current.scrollTop = scrollHeight - clientHeight;
    }
  };

  useEffect(() => {
    socket.on("roomUsers", ({ users }) => {
        const others = users.filter(u => u !== username);
        setRoomUsers(others);
    });

    socket.on("message", async (data) => {
      if (data.username === "System") {
         setMessages((prev) => [...prev, data]);
         return;
      }
      if (data.username === username) return; 

      const handleSuccess = (decryptedText) => {
          dispatchProcess(false, decryptedText, formatForDisplay(data.content));
          setMessages((prev) => [...prev, {
            userId: data.userId, username: data.username, text: decryptedText,
          }]);
      };

      try {
        const decryptedAns = await cryptoService.decrypt(data.username, data.content);
        handleSuccess(decryptedAns);
      } catch (err) {
        if (err.message.includes("Certificate") && err.message.includes("not found")) {
            try {
                const response = await fetch(`http://localhost:5000/api/certificate/${data.username}`);
                if (response.ok) {
                    const cert = await response.json();
                    await cryptoService.establishConnection(data.username, cert);
                    const retryAns = await cryptoService.decrypt(data.username, data.content);
                    handleSuccess(retryAns);
                }
            } catch (fetchErr) { console.error("Key Error:", fetchErr); }
        }
      }
    });

    return () => {
        socket.off("message");
        socket.off("roomUsers");
    };
  }, [socket, username]);

  // Cuộn xuống mỗi khi có tin nhắn mới
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendData = async () => {
    if (text !== "") {
      setMessages((prev) => [...prev, { userId: "me", username: username, text: text }]);
      const msgToSend = text;
      setText("");

      if (roomUsers.length === 0) {
          // alert("Phòng trống..."); // Có thể bỏ alert nếu thấy phiền
      }

      for (const recipient of roomUsers) {
          try {
              try {
                  const res = await fetch(`http://localhost:5000/api/certificate/${recipient}`);
                  if (res.ok) {
                      const cert = await res.json();
                      await cryptoService.establishConnection(recipient, cert);
                  }
              } catch (e) {}

              const encryptedPackage = await cryptoService.encrypt(recipient, msgToSend);
              socket.emit("chat", encryptedPackage);
              dispatchProcess(true, msgToSend, JSON.stringify(encryptedPackage, null, 2));
          } catch (err) {
              console.error(`Send Error to ${recipient}:`, err.message);
          }
      }
    }
  };

  return (
    <div className="chat">
      <div className="user-name">
        <h2>{username} <span style={{ fontSize: "0.8rem", color: "#888" }}>in {roomname}</span></h2>
        <div>
           {roomUsers.length > 0 ? (
               <span style={{color: "#4ade80"}}>● Online: {roomUsers.join(", ")}</span>
           ) : (
               <span style={{color: "#aaa"}}>○ Waiting for others...</span>
           )}
        </div>
      </div>

      {/* GẮN REF VÀO ĐÂY ĐỂ CUỘN */}
      <div className="chat-message" ref={chatContainerRef}>
        {messages.map((i, index) => (
          <div key={index} className={`message ${i.username === username ? "mess-right" : ""}`}>
            <p>{i.text}</p>
            <span>{i.username}</span>
          </div>
        ))}
      </div>
      
      <div className="send">
        <input
          placeholder="Type a message..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyPress={(e) => e.key === "Enter" && sendData()}
        ></input>
        <button onClick={sendData}>SEND</button>
      </div>
    </div>
  );
}
export default Chat;