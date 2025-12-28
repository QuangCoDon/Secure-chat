import './chat.scss';
import { cryptoService } from '../crypto-core/CryptoService';
import { process } from '../store/action/index';
import { useState, useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';

const formatForDisplay = (obj) => {
  return JSON.stringify(obj, null, 2);
};

function Chat({ username, roomname, socket }) {
  const [text, setText] = useState('');
  const [messages, setMessages] = useState([]);
  const [roomUsers, setRoomUsers] = useState([]);
  const dispatch = useDispatch();

  // REF
  const chatContainerRef = useRef(null);
  const fileInputRef = useRef(null); // Ref cho input file ẩn

  const dispatchProcess = (encrypt, msg, cipher) => {
    // Nếu msg quá dài (do là file base64), ta cắt bớt khi log để tránh lag UI Process
    const displayMsg = msg.length > 100 ? msg.substring(0, 50) + '...[FILE DATA]...' : msg;
    dispatch(process(encrypt, displayMsg, cipher));
  };

  const scrollToBottom = () => {
    if (chatContainerRef.current) {
      const { scrollHeight, clientHeight } = chatContainerRef.current;
      chatContainerRef.current.scrollTop = scrollHeight - clientHeight;
    }
  };

  // --- HÀM XỬ LÝ TIN NHẮN ĐẾN ---
  // Cố gắng parse JSON để xem có phải là file không, nếu không phải thì trả về text gốc
  const parseContent = (content) => {
    try {
      const parsed = JSON.parse(content);
      // Kiểm tra cấu trúc xem có phải file do mình quy định không
      if (parsed && parsed.type === 'file' && parsed.data) {
        return parsed;
      }
      return content;
    } catch (e) {
      return content; // Không phải JSON, là tin nhắn text thường
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

      const handleSuccess = (decryptedText) => {
        dispatchProcess(false, decryptedText, formatForDisplay(data.content));

        // Kiểm tra xem nội dung giải mã là File hay Text
        const parsedContent = parseContent(decryptedText);

        setMessages((prev) => [
          ...prev,
          {
            userId: data.userId,
            username: data.username,
            content: parsedContent, // Lưu content đã parse (Object file hoặc String text)
            isFile: typeof parsedContent === 'object', // Cờ đánh dấu
          },
        ]);
      };

      try {
        const decryptedAns = await cryptoService.decrypt(data.username, data.content);
        handleSuccess(decryptedAns);
      } catch (err) {
        if (err.message.includes('Certificate') && err.message.includes('not found')) {
          try {
            const response = await fetch(`http://localhost:5000/api/certificate/${data.username}`);
            if (response.ok) {
              const cert = await response.json();
              await cryptoService.establishConnection(data.username, cert);
              const retryAns = await cryptoService.decrypt(data.username, data.content);
              handleSuccess(retryAns);
            }
          } catch (fetchErr) {
            console.error('Key Error:', fetchErr);
          }
        }
      }
    });

    return () => {
      socket.off('message');
      socket.off('roomUsers');
    };
  }, [socket, username]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // --- HÀM GỬI DỮ LIỆU CHUNG (TEXT HOẶC FILE) ---
  const sendEncryptedPayload = async (rawContent, displayForMe) => {
    // 1. Hiển thị lên màn hình mình trước
    setMessages((prev) => [
      ...prev,
      {
        userId: 'me',
        username: username,
        content: displayForMe,
        isFile: typeof displayForMe === 'object',
      },
    ]);

    if (roomUsers.length === 0) {
      // Có thể alert báo phòng trống
    }

    // Chuỗi cần mã hóa (Nếu là file object thì stringify nó trước)
    const contentToEncrypt =
      typeof rawContent === 'object' ? JSON.stringify(rawContent) : rawContent;

    // 2. Gửi cho từng người nhận
    for (const recipient of roomUsers) {
      try {
        // Kiểm tra kết nối crypto
        try {
          const res = await fetch(`http://localhost:5000/api/certificate/${recipient}`);
          if (res.ok) {
            const cert = await res.json();
            await cryptoService.establishConnection(recipient, cert);
          }
        } catch (e) {}

        // Mã hóa
        const encryptedPackage = await cryptoService.encrypt(recipient, contentToEncrypt);

        // Gửi qua socket
        socket.emit('chat', encryptedPackage);

        // Log vào process
        dispatchProcess(true, contentToEncrypt, JSON.stringify(encryptedPackage, null, 2));
      } catch (err) {
        console.error(`Send Error to ${recipient}:`, err.message);
      }
    }
  };

  // --- GỬI TEXT ---
  const sendText = async () => {
    if (text !== '') {
      await sendEncryptedPayload(text, text);
      setText('');
    }
  };

  // --- GỬI FILE ---
  const handleSelectFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Giới hạn file 5MB (để tránh treo trình duyệt lúc mã hóa)
    if (file.size > 5 * 1024 * 1024) {
      alert('File quá lớn! Vui lòng gửi file dưới 5MB.');
      return;
    }

    const reader = new FileReader();
    reader.readAsDataURL(file); // Đọc file thành chuỗi Base64
    reader.onload = async () => {
      const base64Data = reader.result;

      // Cấu trúc gói tin File
      const filePayload = {
        type: 'file',
        name: file.name,
        mime: file.type,
        data: base64Data,
      };

      // Gửi đi (Raw content là object file, Display cũng là object file)
      await sendEncryptedPayload(filePayload, filePayload);

      // Reset input để chọn lại file giống nhau được
      e.target.value = null;
    };
  };

  // --- RENDER NỘI DUNG TIN NHẮN ---
  const renderMessageContent = (msg) => {
    if (msg.isFile && msg.content && msg.content.type === 'file') {
      const { mime, data, name } = msg.content;

      // Nếu là ảnh -> hiển thị ảnh
      if (mime.startsWith('image/')) {
        return (
          <div>
            <img
              src={data}
              alt={name}
              style={{ maxWidth: '150px', borderRadius: '8px', cursor: 'pointer' }}
              onClick={() => {
                const w = window.open('');
                w.document.write(`<img src="${data}" style="width:100%"/>`);
              }}
            />
          </div>
        );
      }

      // Các file khác -> Hiển thị link download
      return (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            background: 'rgba(0,0,0,0.2)',
            padding: '5px 10px',
            borderRadius: '5px',
          }}
        >
          <span style={{ fontSize: '1.2rem' }}>📎</span>
          <a href={data} download={name} style={{ color: 'inherit', textDecoration: 'underline' }}>
            {name}
          </a>
        </div>
      );
    }
    // Tin nhắn thường
    return <p>{msg.content || msg.text}</p>;
  };

  return (
    <div className="chat">
      <div className="user-name">
        <h2>
          {username} <span style={{ fontSize: '0.8rem', color: '#888' }}>in {roomname}</span>
        </h2>
        <div>
          {roomUsers.length > 0 ? (
            <span style={{ color: '#4ade80' }}>● Online: {roomUsers.join(', ')}</span>
          ) : (
            <span style={{ color: '#aaa' }}>○ Waiting for others...</span>
          )}
        </div>
      </div>

      <div className="chat-message" ref={chatContainerRef}>
        {messages.map((i, index) => (
          <div key={index} className={`message ${i.username === username ? 'mess-right' : ''}`}>
            {/* Gọi hàm render content */}
            {renderMessageContent(i)}
            <span>{i.username}</span>
          </div>
        ))}
      </div>

      <div className="send">
        {/* Nút đính kèm file */}
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
