import "./chat.scss";
import { cryptoService } from "../crypto-core/CryptoService";
import { process } from "../store/action/index";
import { useState, useEffect, useRef, useCallback } from "react";
import { useDispatch } from "react-redux";

const formatForDisplay = (obj) => {
  return JSON.stringify(obj, null, 2);
};

function Chat({ username, roomname, socket }) {
  const [text, setText] = useState("");
  const [messages, setMessages] = useState([]);
  const [roomUsers, setRoomUsers] = useState([]); 
  const dispatch = useDispatch();
  
  // REF ĐỂ CUỘN
  const chatContainerRef = useRef(null);

  const dispatchProcess = useCallback((encrypt, msg, cipher) => {
    dispatch(process(encrypt, msg, cipher));
  }, [dispatch]);

  const scrollToBottom = () => {
    if (chatContainerRef.current) {
      const { scrollHeight, clientHeight } = chatContainerRef.current;
      chatContainerRef.current.scrollTop = scrollHeight - clientHeight;
    }
  };

  useEffect(() => {
    // 1. Cập nhật danh sách người online
    socket.on("roomUsers", ({ users }) => {
        const others = users.filter(u => u !== username);
        setRoomUsers(others);
    });

    // 2. Xử lý tin nhắn đến
    socket.on("message", async (data) => {
      // Tin nhắn hệ thống (Welcome, User joined...)
      if (data.username === "System") {
         setMessages((prev) => [...prev, data]);
         return;
      }

      // Bỏ qua tin nhắn do chính mình gửi (đã render ở hàm sendData rồi)
      if (data.username === username) return; 

      const sender = data.username;

      // Hàm helper để hiển thị tin nhắn thành công
      const handleSuccess = (decryptedText) => {
          dispatchProcess(false, decryptedText, formatForDisplay(data.content));
          setMessages((prev) => [...prev, {
            userId: data.userId, username: sender, text: decryptedText,
          }]);
      };

      try {
        // THỬ LẦN 1: Giải mã bình thường
        const decryptedAns = await cryptoService.decrypt(sender, data.content);
        if (decryptedAns) handleSuccess(decryptedAns);

      } catch (err) {
        console.warn(`⚠️ Giải mã thất bại từ ${sender}. Đang thử tải lại Key...`);
        
        // THỬ LẦN 2: Tự động tải lại Key và thử giải mã lại
        try {
             // 1. Gọi API lấy Key mới nhất của người gửi
             const response = await fetch(`http://localhost:8000/api/certificate/${sender}`);
             
             if (response.ok) {
                 const cert = await response.json();
                 console.log(`🔑 Đã tải Key mới của ${sender}`);
                 
                 // 2. Cập nhật Key vào bộ nhớ
                 await cryptoService.establishConnection(sender, cert);
                 
                 // 3. Thử giải mã lại
                 const retryAns = await cryptoService.decrypt(sender, data.content);
                 
                 if (retryAns) {
                     console.log("✅ Khôi phục tin nhắn thành công!");
                     handleSuccess(retryAns);
                 }
             } else {
                 console.error(`Không thể tải Key của ${sender}`);
             }
        } catch (retryErr) { 
            console.error("❌ Lỗi giải mã hoàn toàn:", retryErr);
            // Có thể hiện tin nhắn lỗi lên giao diện nếu muốn
            // setMessages(prev => [...prev, { username: sender, text: "🔒 [Lỗi giải mã: Tin nhắn không đọc được]" }]);
        }
      }
    });

    return () => {
        socket.off("message");
        socket.off("roomUsers");
    };
  }, [socket, username, dispatchProcess]); // Thêm dispatch vào deps

  // Cuộn xuống mỗi khi có tin nhắn mới
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendData = async () => {
    if (text !== "") {
      // Hiển thị tin mình gửi ngay lập tức
      setMessages((prev) => [...prev, { userId: "me", username: username, text: text }]);
      const msgToSend = text;
      setText("");

      // Gửi cho từng người trong phòng
      for (const recipient of roomUsers) {
          try {
              // 1. Luôn tải Key mới nhất trước khi gửi (Proactive Key Update)
              // Điều này giúp ngăn chặn lỗi xảy ra ngay từ đầu
              // console.log(`Fetching fresh key for ${recipient}...`);
              const res = await fetch(`http://localhost:8000/api/certificate/${recipient}`);
              
              if (res.ok) {
                  const cert = await res.json();
                  await cryptoService.establishConnection(recipient, cert);
              } else {
                  console.warn(`User ${recipient} offline hoặc không có Key.`);
                  continue; 
              }

              // 2. Mã hóa và Gửi
              const encryptedPackage = await cryptoService.encrypt(recipient, msgToSend);
              
              // Gói tin gửi đi cần chứa username người gửi để bên kia biết ai gửi mà decrypt
              // Backend có thể tự gắn username, nhưng frontend gửi kèm để chắc chắn
              // const packetToSend = {
              //     username: username, // Người gửi
              //     content: encryptedPackage,
              //     to: recipient
              // };
              
              socket.emit("chat", encryptedPackage); // Backend của bạn đang nhận gói tin này và broadcast

              // Log ra process
              dispatchProcess(true, msgToSend, JSON.stringify(encryptedPackage, null, 2));

          } catch (err) {
              console.error(`Gửi lỗi tới ${recipient}:`, err.message);
          }
      }
    }
  };

  return (
    <div className="chat">
      <div className="user-name">
        <div className="room-info">
            <h2>{username}</h2> 
            <div>in <span style={{color: "#ccc"}}>{roomname}</span></div>
        </div>
        <div>
           {roomUsers.length > 0 ? (
               <span style={{color: "#4ade80", fontSize: "0.9rem"}}>● Online: {roomUsers.join(", ")}</span>
           ) : (
               <span style={{color: "#aaa", fontSize: "0.9rem"}}>○ Waiting for others...</span>
           )}
        </div>
      </div>

      <div className="chat-message" ref={chatContainerRef}>
        {messages.map((i, index) => {
            // Logic hiển thị tin nhắn hệ thống
            if (i.username === "System") {
                return (
                    <div key={index} style={{textAlign: "center", margin: "10px 0", color: "#666", fontSize: "0.8rem"}}>
                        {i.text}
                    </div>
                );
            }
            return (
              <div key={index} className={`message ${i.username === username ? "mess-right" : ""}`}>
                <p>{i.text}</p>
                <span>{i.username === username ? "Me" : i.username}</span>
              </div>
            );
        })}
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