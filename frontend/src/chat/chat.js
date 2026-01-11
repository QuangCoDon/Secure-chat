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
  
  // STATE QUẢN LÝ ẢNH & ZOOM
  const [viewImage, setViewImage] = useState(null); 
  const [scale, setScale] = useState(1);            

  const dispatch = useDispatch();
  const chatContainerRef = useRef(null);
  const fileInputRef = useRef(null);

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
    if (viewImage) {
      setScale(1);
    }
  }, [viewImage]);

  // --- CÁC HÀM ZOOM ---
  const handleZoomIn = (e) => {
    e.stopPropagation();
    setScale((prev) => prev + 0.2);
  };

  const handleZoomOut = (e) => {
    e.stopPropagation();
    setScale((prev) => (prev > 0.4 ? prev - 0.2 : prev));
  };

  const handleResetZoom = (e) => {
    e.stopPropagation();
    setScale(1);
  };

  const handleWheel = (e) => {
    if (viewImage) {
      if (e.deltaY < 0) {
        setScale((prev) => prev + 0.1);
      } else {
        setScale((prev) => (prev > 0.4 ? prev - 0.1 : prev));
      }
    }
  };

  // --- LOGIC GỐC (PARSE & SOCKET) ---
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

  useEffect(() => {
    socket.on('roomUsers', ({ users }) => {
      const others = users.filter((u) => u !== username);
      setRoomUsers(others);
    });

    socket.on('message', async (data) => {
      if (data.username === 'System') {
        setMessages((prev) => [...prev, { ...data, isFile: false }]);
        return;
      }
      if (data.username === username) return;

      const sender = data.username;
      const handleSuccess = (decryptedText) => {
        dispatchProcess(false, decryptedText, formatForDisplay(data.content));
        const parsedContent = parseContent(decryptedText);
        setMessages((prev) => [
          ...prev,
          {
            userId: data.userId,
            username: data.username,
            text: decryptedText,
            content: parsedContent,
            isFile: typeof parsedContent === 'object',
          },
        ]);
      };

      try {
        const decryptedAns = await cryptoService.decrypt(sender, data.content);
        if (decryptedAns) handleSuccess(decryptedAns);
      } catch (err) {
        console.warn(`⚠️ Giải mã thất bại từ ${sender}. Đang thử tải lại Key...`);
        try {
             const response = await fetch(`http://localhost:8000/api/certificate/${sender}`);
             if (response.ok) {
                 const cert = await response.json();
                 await cryptoService.establishConnection(sender, cert);
                 const retryAns = await cryptoService.decrypt(sender, data.content);
                 if (retryAns) handleSuccess(retryAns);
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

  const sendEncryptedPayload = async (rawContent, displayForMe) => {
    setMessages((prev) => [
      ...prev,
      {
        userId: 'me',
        username: username,
        content: displayForMe,
        text: typeof displayForMe === 'object' ? JSON.stringify(displayForMe) : displayForMe,
        isFile: typeof displayForMe === 'object',
      },
    ]);

    const contentToEncrypt = typeof rawContent === 'object' ? JSON.stringify(rawContent) : rawContent;

    for (const recipient of roomUsers) {
      try {
        try {
          const res = await fetch(`http://localhost:8000/api/certificate/${recipient}`);
          if (res.ok) {
            const cert = await res.json();
            await cryptoService.establishConnection(recipient, cert);
          }
        } catch (e) {}

        const encryptedPackage = await cryptoService.encrypt(recipient, contentToEncrypt);
        socket.emit('chat', encryptedPackage);
        dispatchProcess(true, contentToEncrypt, JSON.stringify(encryptedPackage, null, 2));

      } catch (err) {
        console.error(`Gửi lỗi tới ${recipient}:`, err.message);
      }
    }
  };

  const sendText = async () => {
    if (text !== '') {
      await sendEncryptedPayload(text, text);
      setText('');
    }
  };

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
      e.target.value = null; 
    };
  };

  // --- RENDER MESSAGE CONTENT ---
  const renderMessageContent = (msg) => {
    if (msg.isFile && msg.content && msg.content.type === 'file') {
      const { mime, data, name } = msg.content;
      if (mime.startsWith('image/')) {
        return (
          <div className="image-container">
            <img
              className="chat-thumbnail"
              src={data}
              alt={name}
              onClick={() => setViewImage({ src: data, name: name })}
            />
          </div>
        );
      }
      return (
        <div className="file-attachment">
          <span className="file-icon">📎</span>
          <a href={data} download={name}>{name}</a>
        </div>
      );
    }
    return <p>{msg.content || msg.text}</p>;
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
            if (i.username === "System") {
                return (
                    <div key={index} style={{textAlign: "center", margin: "10px 0", color: "#666", fontSize: "0.8rem"}}>{i.text}</div>
                );
            }
            return (
              <div key={index} className={`message ${i.username === username ? "mess-right" : ""}`}>
                {renderMessageContent(i)}
                <span>{i.username === username ? "Me" : i.username}</span>
              </div>
            );
        })}
      </div>

      <div className="send">
        <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={handleSelectFile} />
        <button
          onClick={() => fileInputRef.current.click()}
          className="btn-attach-file"
          title="Attach File"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24">
            <path d="M0 0h24v24H0V0z" fill="none" />
            <path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 0 0 5 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z" fill="#ffffff"/>
          </svg>
        </button>
        <input placeholder="Type a message..." value={text} onChange={(e) => setText(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && sendText()} />
        <button className="btn-send-text" onClick={sendText}>SEND</button>
      </div>

      {/* --- MODAL XEM ẢNH + ZOOM --- */}
      {viewImage && (
        <div 
          className="lightbox-overlay"
          onClick={() => setViewImage(null)}
          onWheel={handleWheel}
        >
          {/* Nút đóng */}
          <div 
            className="lightbox-close"
            onClick={(e) => { e.stopPropagation(); setViewImage(null); }}
          >✕</div>

          {/* Vùng chứa ảnh */}
          <div className="lightbox-content">
             <img 
               className="lightbox-image"
               src={viewImage.src} 
               alt={viewImage.name}
               onClick={(e) => e.stopPropagation()} 
               style={{
                 transform: `scale(${scale})`, // Vẫn cần inline style vì giá trị động
                 cursor: scale > 1 ? 'grab' : 'default',
               }}
             />
          </div>

          {/* Thanh công cụ Zoom */}
          <div className="zoom-controls" onClick={(e) => e.stopPropagation()}>
             <button className="zoom-btn" onClick={handleZoomOut}>-</button>
             <span className="zoom-text">{Math.round(scale * 100)}%</span>
             <button className="zoom-btn" onClick={handleResetZoom}>↺</button>
             <button className="zoom-btn" onClick={handleZoomIn}>+</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Chat;