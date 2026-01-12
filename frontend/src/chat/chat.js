import "./chat.scss";
import { cryptoService } from "../crypto-core/CryptoService";
import { process } from "../store/action/index";
import { useState, useEffect, useRef, useCallback } from "react";
import { useDispatch } from "react-redux";

const formatForDisplay = (obj) => {
  return JSON.stringify(obj, null, 2);
};

const generateId = () =>
  Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);

function Chat({ username, roomname, socket }) {
  const [text, setText] = useState("");
  const [messages, setMessages] = useState([]);
  const [roomUsers, setRoomUsers] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState("");
  const [menuOpenId, setMenuOpenId] = useState(null);
  const dispatch = useDispatch();

  // REF ĐỂ CUỘN
  const chatContainerRef = useRef(null);
  const fileInputRef = useRef(null); // Ref cho input file ẩn

  const dispatchProcess = useCallback(
    (encrypt, msg, cipher) => {
      dispatch(process(encrypt, msg, cipher));
    },
    [dispatch]
  );

  const scrollToBottom = () => {
    if (chatContainerRef.current) {
      const { scrollHeight, clientHeight } = chatContainerRef.current;
      chatContainerRef.current.scrollTop = scrollHeight - clientHeight;
    }
  };

  // Edit/Delete helpers
  const startEdit = (msg) => {
    try {
      setMenuOpenId(null);
      setEditingId(msg.id);
      setEditingText(
        msg.content && msg.content.type === "message"
          ? msg.content.body
          : msg.text || ""
      );
    } catch (err) {
      console.error("startEdit failed", err);
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingText("");
  };

  const confirmEdit = async (id, e) => {
    e?.preventDefault();
    e?.stopPropagation();

    const payload = { type: "edit", id, body: editingText };

    // ✅ Update local message
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id
          ? {
              ...m,
              text: editingText,
              content:
                m.content && m.content.type === "message"
                  ? { ...m.content, body: editingText }
                  : m.content,
              edited: true,
            }
          : m
      )
    );

    cancelEdit();

    // ✅ GỬI SOCKET – KHÔNG ADD MESSAGE
    await sendEncryptedPayload(payload, null);
  };

  const confirmDelete = async (id, e) => {
    e?.preventDefault();
    e?.stopPropagation();

    if (!window.confirm("Bạn có chắc chắn muốn xóa tin nhắn này?")) return;

    const payload = { type: "delete", id };

    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, deleted: true } : m))
    );

    await sendEncryptedPayload(payload, payload);
  };

  // --- HÀM 1: Parse JSON để kiểm tra File ---
  const parseContent = (content) => {
    try {
      const parsed = JSON.parse(content);
      if (parsed && parsed.type) {
        return parsed;
      }
      return content;
    } catch (e) {
      return content;
    }
  };

  // --- HÀM 2: Lắng nghe Socket ---
  useEffect(() => {
    socket.on("roomUsers", ({ users }) => {
      const others = users.filter((u) => u !== username);
      setRoomUsers(others);
    });

    socket.on("message", async (data) => {
      try {
        // Tin nhắn hệ thống
        if (data.username === "System") {
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

          if (
            parsedContent &&
            typeof parsedContent === "object" &&
            parsedContent.type
          ) {
            if (
              parsedContent.type === "message" ||
              parsedContent.type === "file"
            ) {
              setMessages((prev) => [
                ...prev,
                {
                  id: parsedContent.id || generateId(),
                  userId: data.userId,
                  username: data.username,
                  text:
                    parsedContent.type === "message"
                      ? parsedContent.body
                      : JSON.stringify(parsedContent),
                  content: parsedContent,
                  isFile: parsedContent.type === "file",
                  edited: false,
                  deleted: false,
                },
              ]);
            } else if (parsedContent.type === "edit") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === parsedContent.id
                    ? {
                        ...m,
                        content: parsedContent,
                        text: parsedContent.body,
                        edited: true,
                      }
                    : m
                )
              );
            } else if (parsedContent.type === "delete") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === parsedContent.id ? { ...m, deleted: true } : m
                )
              );
            } else {
              setMessages((prev) => [
                ...prev,
                {
                  id: generateId(),
                  userId: data.userId,
                  username: data.username,
                  text: decryptedText,
                  content: parsedContent,
                  isFile: false,
                  edited: false,
                  deleted: false,
                },
              ]);
            }
          } else {
            // Plain text fallback
            setMessages((prev) => [
              ...prev,
              {
                id: generateId(),
                userId: data.userId,
                username: data.username,
                text: decryptedText,
                content: parsedContent,
                isFile: false,
                edited: false,
                deleted: false,
              },
            ]);
          }
        };

        try {
          // THỬ LẦN 1
          const decryptedAns = await cryptoService.decrypt(
            sender,
            data.content
          );
          if (decryptedAns) handleSuccess(decryptedAns);
        } catch (err) {
          console.warn(
            `⚠️ Giải mã thất bại từ ${sender}. Đang thử tải lại Key...`
          );

          // THỬ LẦN 2 (Retry logic)
          try {
            const response = await fetch(
              `http://localhost:8000/api/certificate/${sender}`
            );

            if (response.ok) {
              const cert = await response.json();
              console.log(`🔑 Đã tải Key mới của ${sender}`);

              await cryptoService.establishConnection(sender, cert);

              const retryAns = await cryptoService.decrypt(
                sender,
                data.content
              );
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
      } catch (e) {
        console.error("message handler error", e);
      }
    });

    // Re-join room if socket reconnects (helps recover from transient reload/disconnect)
    socket.on("connect", () => {
      try {
        socket.emit("joinRoom", { username, roomname: roomname });
      } catch (e) {
        console.warn("Rejoin failed:", e);
      }
    });

    return () => {
      socket.off("message");
      socket.off("roomUsers");
      socket.off("connect");
    };
  }, [socket, username, dispatchProcess, roomname]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // --- HÀM 3: GỬI DỮ LIỆU (FIX edit/delete không add message) ---
  const sendEncryptedPayload = async (rawContent, displayForMe) => {
    // ✅ CHỈ hiển thị local với message / file
    if (
      displayForMe &&
      (displayForMe.type === "message" || displayForMe.type === "file")
    ) {
      setMessages((prev) => [
        ...prev,
        {
          id: displayForMe.id || generateId(),
          userId: "me",
          username,
          content: displayForMe,
          text:
            displayForMe.type === "message"
              ? displayForMe.body
              : JSON.stringify(displayForMe),
          isFile: displayForMe.type === "file",
          edited: false,
          deleted: false,
        },
      ]);
    }

    // Chuỗi cần mã hóa
    const contentToEncrypt =
      typeof rawContent === "object" ? JSON.stringify(rawContent) : rawContent;

    // 2. Gửi cho từng người nhận
    for (const recipient of roomUsers) {
      try {
        // Bước A: đảm bảo có key mới nhất
        try {
          const res = await fetch(
            `http://localhost:8000/api/certificate/${recipient}`
          );
          if (res.ok) {
            const cert = await res.json();
            await cryptoService.establishConnection(recipient, cert);
          }
        } catch {
          console.warn(
            `Không thể fetch key của ${recipient}, dùng key cache cũ.`
          );
        }

        // Bước B: mã hóa
        const encryptedPackage = await cryptoService.encrypt(
          recipient,
          contentToEncrypt
        );

        // Bước C: gửi socket
        socket.emit("chat", encryptedPackage);

        // Bước D: log
        dispatchProcess(
          true,
          contentToEncrypt,
          JSON.stringify(encryptedPackage, null, 2)
        );
      } catch (err) {
        console.error(`Gửi lỗi tới ${recipient}:`, err.message);
      }
    }
  };

  // --- HÀM 4: Xử lý gửi Text ---
  const sendText = async () => {
    if (text !== "") {
      const id = generateId();
      const payload = { type: "message", id, body: text };
      await sendEncryptedPayload(payload, payload);
      setText("");
    }
  };

  // --- HÀM 5: Xử lý gửi File ---
  const handleSelectFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert("File quá lớn! Vui lòng gửi file dưới 5MB.");
      return;
    }

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
      const base64Data = reader.result;

      const filePayload = {
        type: "file",
        id: generateId(),
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
    if (msg.deleted) {
      return (
        <em style={{ color: "#999", fontStyle: "italic" }}>Message deleted</em>
      );
    }

    if (editingId === msg.id && msg.username === username) {
      return (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            background: "rgba(255,255,255,0.05)",
            padding: "6px",
            borderRadius: "8px",
            width: "100%",
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <input
            autoFocus
            value={editingText}
            onChange={(e) => setEditingText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                confirmEdit(msg.id, e);
              }
              if (e.key === "Escape") {
                cancelEdit();
              }
            }}
            style={{
              flex: 1,
              background: "#1f2933",
              color: "#e5e7eb",
              border: "1px solid #374151",
              borderRadius: "6px",
              padding: "6px 10px",
              fontSize: "0.9rem",
              outline: "none",
            }}
          />

          {/* SAVE */}
          <button
            type="button"
            onClick={(e) => confirmEdit(msg.id, e)}
            style={{
              background: "#22c55e",
              color: "#022c22",
              border: "none",
              borderRadius: "6px",
              padding: "4px 10px",
              fontSize: "0.75rem",
              fontWeight: 500,
              cursor: "pointer",
              height: "28px",
            }}
          >
            Save
          </button>

          {/* CANCEL */}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              cancelEdit();
            }}
            style={{
              background: "#374151",
              color: "#e5e7eb",
              border: "none",
              borderRadius: "6px",
              padding: "4px 10px",
              fontSize: "0.75rem",
              cursor: "pointer",
              height: "28px",
            }}
          >
            Cancel
          </button>
        </div>
      );
    }

    // Nếu là file
    if (msg.isFile && msg.content && msg.content.type === "file") {
      const { mime, data, name } = msg.content;

      // Ảnh
      if (mime.startsWith("image/")) {
        return (
          <div>
            <img
              src={data}
              alt={name}
              style={{
                maxWidth: "200px",
                maxHeight: "200px",
                borderRadius: "8px",
                cursor: "pointer",
                display: "block",
              }}
              onClick={() => {
                const w = window.open("");
                w.document.write(`<img src="${data}" style="width:100%"/>`);
              }}
            />
          </div>
        );
      }

      // File tải xuống
      return (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: "rgba(0,0,0,0.2)",
            padding: "8px 12px",
            borderRadius: "6px",
          }}
        >
          <span style={{ fontSize: "1.2rem" }}>📎</span>
          <a
            href={data}
            download={name}
            style={{ color: "#4ade80", textDecoration: "underline" }}
          >
            {name}
          </a>
        </div>
      );
    }

    // Nếu là text thường hoặc message object
    if (
      msg.content &&
      typeof msg.content === "object" &&
      msg.content.type === "message"
    ) {
      return <p>{msg.content.body}</p>;
    }

    // Message edit (local echo)
    if (msg.content && msg.content.type === "edit") {
      return <p>{msg.text}</p>;
    }

    // Fallback
    return <p>{msg.text}</p>;
  };

  // --- RENDER GIAO DIỆN ---
  return (
    <div className="chat">
      <div className="user-name">
        <div className="room-info">
          <h2>{username}</h2>
          <div>
            in <span style={{ color: "#ccc" }}>{roomname}</span>
          </div>
        </div>
        <div>
          {roomUsers.length > 0 ? (
            <span style={{ color: "#4ade80", fontSize: "0.9rem" }}>
              ● Online: {roomUsers.join(", ")}
            </span>
          ) : (
            <span style={{ color: "#aaa", fontSize: "0.9rem" }}>
              ○ Waiting for others...
            </span>
          )}
        </div>
      </div>

      <div className="chat-message" ref={chatContainerRef}>
        {messages.map((i, index) => {
          if (i.username === "System") {
            return (
              <div
                key={i.id || index}
                style={{
                  textAlign: "center",
                  margin: "10px 0",
                  color: "#666",
                  fontSize: "0.8rem",
                }}
              >
                {i.text}
              </div>
            );
          }
          return (
            <div
              key={i.id || index}
              className={`message ${
                i.username === username ? "mess-right" : ""
              }`}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {renderMessageContent(i)}
                  {i.edited && (
                    <small style={{ fontSize: "0.7rem", color: "#999" }}>
                      (edited)
                    </small>
                  )}
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    {i.username === username && !i.deleted && (
                      <div style={{ position: "relative" }}>
                        <button
                          type="button"
                          className="msg-menu-btn"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setMenuOpenId(menuOpenId === i.id ? null : i.id);
                          }}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "#9ca3af",
                            fontSize: "1.1rem",
                            cursor: "pointer",
                            padding: "2px 6px",
                            lineHeight: 1,
                            borderRadius: "4px",
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.color = "#e5e7eb")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.color = "#9ca3af")
                          }
                        >
                          ⋮
                        </button>

                        {menuOpenId === i.id && (
                          <div
                            style={{
                              position: "absolute",
                              right: 0,
                              top: "26px",
                              background: "#222",
                              color: "#fff",
                              borderRadius: 6,
                              padding: "6px",
                              boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                            }}
                          >
                            <div
                              style={{ cursor: "pointer", padding: "4px 8px" }}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                startEdit(i);
                              }}
                            >
                              Edit
                            </div>

                            <div
                              style={{ cursor: "pointer", padding: "4px 8px" }}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                confirmDelete(i.id, e);
                              }}
                            >
                              Delete
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <span style={{ fontSize: "0.9rem", color: "#bbb" }}>
                    {i.username === username ? "me" : i.username}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="send">
        {/* Input file ẩn */}
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: "none" }}
          onChange={handleSelectFile}
        />

        <button
          type="button"
          onClick={() => fileInputRef.current.click()}
          className="btn-attach-file"
          title="Attach File"
          // Thêm style này để đảm bảo icon luôn nằm giữa nút
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0, // Reset padding nếu có
          }}
        >
          {/* --- BẮT ĐẦU MÃ SVG TRỰC TIẾP --- */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            height="24"
            viewBox="0 0 24 24"
            width="24"
          >
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
          onKeyPress={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              sendText();
            }
          }}
        ></input>
        <button type="button" onClick={sendText}>
          SEND
        </button>
      </div>
    </div>
  );
}

export default Chat;
