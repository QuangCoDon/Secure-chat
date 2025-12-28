import "./chat.scss";
import { cryptoService } from "../crypto-core/CryptoService";
import { process } from "../store/action/index";
import { useState, useEffect, useRef, useCallback } from "react";
import { useDispatch } from "react-redux";

const formatForDisplay = (obj) => {
  return JSON.stringify(obj, null, 2);
};

function Chat({ username, roomname, socket }) {
  const [text, setText] = useState('');
  const [messages, setMessages] = useState([]);
  const [roomUsers, setRoomUsers] = useState([]);
  const dispatch = useDispatch();
  
  // REF ĐỂ CUỘN
  const chatContainerRef = useRef(null);
  const fileInputRef = useRef(null); // Ref cho input file ẩn

  const dispatchProcess = useCallback((encrypt, msg, cipher) => {
    dispatch(process(encrypt, msg, cipher));
  }, [dispatch]);

  const scrollToBottom = () => {
    if (chatContainerRef.current) {
      const { scrollHeight, clientHeight } = chatContainerRef.current;
      chatContainerRef.current.scrollTop = scrollHeight - clientHeight;
    }
  };

  // --- HÀM 1: Parse JSON để kiểm tra File ---
  const parseContent = (content) => {
    try {
      const parsed = JSON.parse(content);
      if (parsed && parsed.type === 'file' && parsed.data) {
        return parsed;
      }
      return content;
    } catch (e) {
      return content; 
    }
  };

  // --- HÀM 2: Lắng nghe Socket ---
  useEffect(() => {
    socket.on('roomUsers', ({ users }) => {
      const others = users.filter((u) => u !== username);
      setRoomUsers(others);
    });

    socket.on('message', async (data) => {
      // Tin nhắn hệ thống
      if (data.username === 'System') {
        setMessages((prev) => [...prev, { ...data, isFile: false }]);
        return;
      }
      // Bỏ qua tin nhắn của chính mình
      if (data.username === username) return;

      const sender = data.username;

      // Helper xử lý thành công
      const handleSuccess = (decryptedText) => {
        dispatchProcess(false, decryptedText, formatForDisplay(data.content));

        const parsedContent = parseContent(decryptedText);

        setMessages((prev) => [
          ...prev,
          {
            userId: data.userId,
            username: data.username,
            text: decryptedText, // Text gốc (json string nếu là file)
            content: parsedContent, // Object file hoặc string text
            isFile: typeof parsedContent === 'object', // Cờ đánh dấu
          },
        ]);
      };

      try {
        // THỬ LẦN 1
        const decryptedAns = await cryptoService.decrypt(sender, data.content);
        if (decryptedAns) handleSuccess(decryptedAns);

      } catch (err) {
        console.warn(`⚠️ Giải mã thất bại từ ${sender}. Đang thử tải lại Key...`);
        
        // THỬ LẦN 2 (Retry logic)
        try {
             const response = await fetch(`http://localhost:8000/api/certificate/${sender}`);
             
             if (response.ok) {
                 const cert = await response.json();
                 console.log(`🔑 Đã tải Key mới của ${sender}`);
                 
                 await cryptoService.establishConnection(sender, cert);
                 
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
        }
      }
    });

    return () => {
      socket.off('message');
      socket.off('roomUsers');
    };
  }, [socket, username, dispatchProcess]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // --- HÀM 3: GỬI DỮ LIỆU (Đã sửa lỗi copy-paste) ---
  const sendEncryptedPayload = async (rawContent, displayForMe) => {
    // 1. Hiển thị lên màn hình mình trước
    setMessages((prev) => [
      ...prev,
      {
        userId: 'me',
        username: username,
        content: displayForMe, // Object file hoặc text
        text: typeof displayForMe === 'object' ? JSON.stringify(displayForMe) : displayForMe,
        isFile: typeof displayForMe === 'object',
      },
    ]);

    // Chuỗi cần mã hóa
    const contentToEncrypt = typeof rawContent === 'object' ? JSON.stringify(rawContent) : rawContent;

    // 2. Gửi cho từng người nhận
    for (const recipient of roomUsers) {
      try {
        // Bước A: Đảm bảo có Key mới nhất
        try {
          const res = await fetch(`http://localhost:8000/api/certificate/${recipient}`);
          if (res.ok) {
            const cert = await res.json();
            await cryptoService.establishConnection(recipient, cert);
          }
        } catch (e) {
             console.warn(`Không thể fetch key của ${recipient}, dùng key cache cũ.`);
        }

        // Bước B: Mã hóa
        const encryptedPackage = await cryptoService.encrypt(recipient, contentToEncrypt);

        // Bước C: Gửi qua socket
        socket.emit('chat', encryptedPackage);

        // Bước D: Log vào process
        dispatchProcess(true, contentToEncrypt, JSON.stringify(encryptedPackage, null, 2));

      } catch (err) {
        console.error(`Gửi lỗi tới ${recipient}:`, err.message);
      }
    }
  };

  // --- HÀM 4: Xử lý gửi Text ---
  const sendText = async () => {
    if (text !== '') {
      await sendEncryptedPayload(text, text);
      setText('');
    }
  };

  // --- HÀM 5: Xử lý gửi File ---
  const handleSelectFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert('File quá lớn! Vui lòng gửi file dưới 5MB.');
      return;
    }

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
      const base64Data = reader.result;

      const filePayload = {
        type: 'file',
        name: file.name,
        mime: file.type,
        data: base64Data,
      };

      await sendEncryptedPayload(filePayload, filePayload);
      e.target.value = null; // Reset input
    };
  };

  // --- HÀM 6: Render nội dung tin nhắn (Ảnh/File/Text) ---
  const renderMessageContent = (msg) => {
    // Nếu là file
    if (msg.isFile && msg.content && msg.content.type === 'file') {
      const { mime, data, name } = msg.content;

      // Ảnh
      if (mime.startsWith('image/')) {
        return (
          <div>
            <img
              src={data}
              alt={name}
              style={{ maxWidth: '200px', maxHeight: '200px', borderRadius: '8px', cursor: 'pointer', display: 'block' }}
              onClick={() => {
                const w = window.open('');
                w.document.write(`<img src="${data}" style="width:100%"/>`);
              }}
            />
          </div>
        );
      }

      // File tải xuống
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(0,0,0,0.2)', padding: '8px 12px', borderRadius: '6px' }}>
          <span style={{ fontSize: '1.2rem' }}>📎</span>
          <a href={data} download={name} style={{ color: '#4ade80', textDecoration: 'underline' }}>
            {name}
          </a>
        </div>
      );
    }
    
    // Nếu là text thường
    return <p>{msg.content || msg.text}</p>;
  };

  // --- RENDER GIAO DIỆN ---
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
            if (i.username === "System") {
                return (
                    <div key={index} style={{textAlign: "center", margin: "10px 0", color: "#666", fontSize: "0.8rem"}}>
                        {i.text}
                    </div>
                );
            }
            return (
              <div key={index} className={`message ${i.username === username ? "mess-right" : ""}`}>
                {/* SỬA LỖI: Dùng hàm renderMessageContent thay vì thẻ p */}
                {renderMessageContent(i)}
                <span>{i.username === username ? "Me" : i.username}</span>
              </div>
            );
        })}
      </div>

      <div className="send">
        {/* Input file ẩn */}
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          onChange={handleSelectFile}
        />
        
        <button
          onClick={() => fileInputRef.current.click()}
          className="btn-attach-file"
          title="Attach File"
          // Thêm style này để đảm bảo icon luôn nằm giữa nút
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0, // Reset padding nếu có
          }}
        >
          {/* --- BẮT ĐẦU MÃ SVG TRỰC TIẾP --- */}
          <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24">
            {/* Lớp nền trong suốt */}
            <path d="M0 0h24v24H0V0z" fill="none" />
            {/* Lớp vẽ icon - ĐƯỢC TÔ MÀU TRẮNG CỨNG Ở ĐÂY */}
            <path
              d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 0 0 5 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"
              fill="#ffffff"
            />
          </svg>
          {/* --- KẾT THÚC MÃ SVG --- */}
        </button>

        <input
          placeholder="Type a message..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && sendText()}
        ></input>
        <button onClick={sendText}>SEND</button>
      </div>
    </div>
  );
}

export default Chat;