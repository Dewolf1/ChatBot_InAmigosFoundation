/**
 * InAmigos Foundation Chat Widget
 * -------------------------------
 * Drop-in embeddable chat widget. No build step, no dependencies.
 *
 * Usage (paste into any website, anywhere before </body>):
 *
 *   <script
 *     src="https://YOUR-CDN-OR-HOST/widget.js"
 *     data-api="https://your-backend.onrender.com"
 *     data-org="InAmigos Foundation">
 *   </script>
 *
 * The widget reads its config from the <script> tag's data-* attributes,
 * so the SAME file can be reused by any site / any backend URL without
 * editing this source.
 */
(function () {
  "use strict";

  // ---- Config, pulled from the <script> tag that loaded this file ----
  var currentScript = document.currentScript;
  var API_BASE = (currentScript && currentScript.getAttribute("data-api")) || "http://localhost:8000";
  var ORG_NAME = (currentScript && currentScript.getAttribute("data-org")) || "InAmigos Foundation";
  var ACCENT = (currentScript && currentScript.getAttribute("data-accent")) || "#1F4B43";
  var ACCENT_LIGHT = (currentScript && currentScript.getAttribute("data-accent-light")) || "#E7A94C";

  // ---- Quick reply buttons shown on first open ----
  var QUICK_REPLIES = [
    { label: "🏛️ About InAmigos",     message: "What is InAmigos Foundation?" },
    { label: "🎓 Internship Info",     message: "Does InAmigos Foundation offer internships?" },
    { label: "💰 How to Donate",       message: "How can I donate to InAmigos Foundation?" },
    { label: "🤝 Volunteer",           message: "How can I volunteer with InAmigos Foundation?" },
    { label: "📋 Our Programs",        message: "What does InAmigos Foundation do?" },
    { label: "📞 Contact Us",          message: "What is the phone number or contact number of InAmigos Foundation?" },
  ];

  // ---- Session handling (persists across page loads in this browser tab) ----
  var SESSION_KEY = "iaf_chat_session_id";
  function getSessionId() {
    var id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  }

  // ---- Styles (scoped with a unique prefix to avoid clashing with host site CSS) ----
  var style = document.createElement("style");
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

    .iafw-bubble {
      position: fixed; bottom: 22px; right: 22px; z-index: 999999;
      width: 60px; height: 60px; border-radius: 50%;
      background: linear-gradient(135deg, ${ACCENT} 0%, #2a6b5e 100%);
      color: #fff; border: none; cursor: pointer;
      box-shadow: 0 6px 24px rgba(31,75,67,0.4), 0 0 0 0 rgba(31,75,67,0.3);
      display: flex; align-items: center; justify-content: center;
      font-size: 26px; font-family: 'Inter', Arial, sans-serif;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      animation: iafw-pulse 2.5s infinite;
    }
    @keyframes iafw-pulse {
      0%, 100% { box-shadow: 0 6px 24px rgba(31,75,67,0.4), 0 0 0 0 rgba(31,75,67,0.3); }
      50% { box-shadow: 0 6px 24px rgba(31,75,67,0.4), 0 0 0 12px rgba(31,75,67,0); }
    }
    .iafw-bubble:hover {
      transform: scale(1.08);
      box-shadow: 0 8px 28px rgba(31,75,67,0.5);
      animation: none;
    }

    .iafw-window {
      position: fixed; bottom: 92px; right: 22px; z-index: 999999;
      width: 370px; max-width: calc(100vw - 32px);
      height: 520px; max-height: calc(100vh - 140px);
      background: #fff; border-radius: 16px; overflow: hidden;
      box-shadow: 0 12px 48px rgba(0,0,0,0.18), 0 4px 12px rgba(0,0,0,0.08);
      display: none; flex-direction: column;
      font-family: 'Inter', -apple-system, Arial, sans-serif;
      transition: opacity 0.2s ease, transform 0.2s ease;
    }
    .iafw-window.iafw-open {
      display: flex;
      animation: iafw-slideup 0.25s ease-out;
    }
    @keyframes iafw-slideup {
      from { opacity: 0; transform: translateY(16px) scale(0.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .iafw-header {
      background: linear-gradient(135deg, ${ACCENT} 0%, #2a6b5e 100%);
      color: #fff; padding: 16px 18px;
      display: flex; justify-content: space-between; align-items: flex-start;
    }
    .iafw-header-info h3 {
      margin: 0; font-size: 15px; font-weight: 700; letter-spacing: -0.01em;
    }
    .iafw-header-info span {
      display: block; font-weight: 400; font-size: 11.5px; opacity: 0.8; margin-top: 3px;
    }
    .iafw-status-dot {
      display: inline-block; width: 7px; height: 7px; background: #4ade80;
      border-radius: 50%; margin-right: 5px; vertical-align: middle;
    }
    .iafw-close {
      background: rgba(255,255,255,0.15); border: none; color: #fff;
      font-size: 16px; cursor: pointer; line-height: 1;
      width: 28px; height: 28px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.15s;
    }
    .iafw-close:hover { background: rgba(255,255,255,0.25); }

    .iafw-messages {
      flex: 1; overflow-y: auto; padding: 14px; background: #f7f5f0;
      display: flex; flex-direction: column; gap: 10px;
      scroll-behavior: smooth;
    }
    .iafw-messages::-webkit-scrollbar { width: 4px; }
    .iafw-messages::-webkit-scrollbar-track { background: transparent; }
    .iafw-messages::-webkit-scrollbar-thumb { background: #ccc; border-radius: 4px; }

    .iafw-msg {
      max-width: 84%; padding: 10px 13px; border-radius: 12px;
      font-size: 13.5px; line-height: 1.5; word-break: break-word;
      animation: iafw-fadein 0.2s ease-out;
    }
    @keyframes iafw-fadein {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .iafw-msg.user {
      align-self: flex-end;
      background: linear-gradient(135deg, ${ACCENT} 0%, #2a6b5e 100%);
      color: #fff; border-bottom-right-radius: 4px;
    }
    .iafw-msg.bot {
      align-self: flex-start; background: #fff; color: #23281F;
      border: 1px solid #e8e2d0; border-bottom-left-radius: 4px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.04);
    }
    .iafw-msg.typing {
      align-self: flex-start; color: #8a8572; font-style: italic; font-size: 12.5px;
      background: #fff; border: 1px solid #e8e2d0; border-bottom-left-radius: 4px;
    }

    /* ---- Quick Reply Buttons ---- */
    .iafw-quick-replies {
      display: flex; flex-wrap: wrap; gap: 6px; padding: 0;
      margin-top: 6px; align-self: flex-start; max-width: 100%;
    }
    .iafw-quick-btn {
      background: #fff; color: ${ACCENT}; border: 1.5px solid ${ACCENT};
      border-radius: 20px; padding: 7px 14px; font-size: 12.5px; font-weight: 500;
      cursor: pointer; font-family: 'Inter', Arial, sans-serif;
      transition: all 0.15s ease; white-space: nowrap;
      line-height: 1.3;
    }
    .iafw-quick-btn:hover {
      background: ${ACCENT}; color: #fff;
      transform: translateY(-1px);
      box-shadow: 0 3px 10px rgba(31,75,67,0.2);
    }
    .iafw-quick-btn:active { transform: translateY(0); }

    /* ---- Welcome message styling ---- */
    .iafw-welcome-text {
      font-size: 13.5px; line-height: 1.5; color: #23281F;
      margin-bottom: 4px;
    }
    .iafw-welcome-sub {
      font-size: 11.5px; color: #8a8572; margin-top: 6px;
      padding-top: 6px; border-top: 1px solid #f0ece2;
    }

    /* ---- Input Row ---- */
    .iafw-inputrow {
      display: flex; border-top: 1px solid #e8e2d0; padding: 10px 12px;
      gap: 8px; background: #fff;
    }
    .iafw-input {
      flex: 1; border: 1.5px solid #ddd5c4; border-radius: 10px;
      padding: 9px 12px; font-size: 13.5px; outline: none;
      font-family: 'Inter', Arial, sans-serif;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .iafw-input:focus {
      border-color: ${ACCENT};
      box-shadow: 0 0 0 3px rgba(31,75,67,0.08);
    }
    .iafw-send {
      background: linear-gradient(135deg, ${ACCENT_LIGHT} 0%, #d4922e 100%);
      color: #182B45; border: none; border-radius: 10px;
      padding: 0 16px; font-weight: 600; cursor: pointer; font-size: 13px;
      font-family: 'Inter', Arial, sans-serif;
      transition: transform 0.1s, box-shadow 0.15s;
    }
    .iafw-send:hover {
      transform: translateY(-1px);
      box-shadow: 0 3px 10px rgba(231,169,76,0.3);
    }
    .iafw-send:active { transform: translateY(0); }
    .iafw-send:disabled { opacity: 0.45; cursor: default; transform: none; box-shadow: none; }

    /* ---- Powered-by footer ---- */
    .iafw-footer {
      text-align: center; font-size: 10px; color: #b5ad9a;
      padding: 4px 0 6px; background: #fff; border-top: 1px solid #f0ece2;
    }
  `;
  document.head.appendChild(style);

  // ---- DOM structure ----
  var bubble = document.createElement("button");
  bubble.className = "iafw-bubble";
  bubble.setAttribute("aria-label", "Open chat");
  bubble.innerHTML = "💬";

  var win = document.createElement("div");
  win.className = "iafw-window";
  win.innerHTML = `
    <div class="iafw-header">
      <div class="iafw-header-info">
        <h3>${ORG_NAME}</h3>
        <span><span class="iafw-status-dot"></span>Online — Usually replies instantly</span>
      </div>
      <button class="iafw-close" aria-label="Close chat">&times;</button>
    </div>
    <div class="iafw-messages"></div>
    <div class="iafw-inputrow">
      <input class="iafw-input" type="text" placeholder="Type your question..." />
      <button class="iafw-send">Send</button>
    </div>
    <div class="iafw-footer">Powered by InAmigos Foundation</div>
  `;

  document.body.appendChild(bubble);
  document.body.appendChild(win);

  var messagesEl = win.querySelector(".iafw-messages");
  var inputEl = win.querySelector(".iafw-input");
  var sendBtn = win.querySelector(".iafw-send");
  var closeBtn = win.querySelector(".iafw-close");

  // ---- Message rendering ----
  function addMessage(text, role) {
    var el = document.createElement("div");
    el.className = "iafw-msg " + role;
    el.textContent = text;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  function addWelcomeMessage() {
    // Bot welcome bubble with rich content
    var botEl = document.createElement("div");
    botEl.className = "iafw-msg bot";
    botEl.innerHTML = `
      <div class="iafw-welcome-text">
        Hi! 👋 I'm the <strong>${ORG_NAME}</strong> assistant.<br>
        I can help you with information about our programs, internships, donations, and more.
      </div>
      <div class="iafw-welcome-sub">Choose a topic below or type your own question ⬇️</div>
    `;
    messagesEl.appendChild(botEl);

    // Quick reply buttons
    var qrContainer = document.createElement("div");
    qrContainer.className = "iafw-quick-replies";

    QUICK_REPLIES.forEach(function (qr) {
      var btn = document.createElement("button");
      btn.className = "iafw-quick-btn";
      btn.textContent = qr.label;
      btn.addEventListener("click", function () {
        handleQuickReply(qr.message, qrContainer);
      });
      qrContainer.appendChild(btn);
    });

    messagesEl.appendChild(qrContainer);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function handleQuickReply(message, qrContainer) {
    // Fade out the quick replies after clicking
    qrContainer.style.transition = "opacity 0.2s ease";
    qrContainer.style.opacity = "0";
    setTimeout(function () {
      qrContainer.remove();
    }, 200);

    // Send the message as if the user typed it
    sendMessage(message);
  }

  // ---- Show quick replies again after a bot response ----
  function showFollowUpReplies() {
    var qrContainer = document.createElement("div");
    qrContainer.className = "iafw-quick-replies";

    var followUps = [
      { label: "🎓 Internships",  message: "Does InAmigos Foundation offer internships?" },
      { label: "💰 Donate",       message: "How can I donate to InAmigos Foundation?" },
      { label: "📋 Programs",     message: "What does InAmigos Foundation do?" },
      { label: "📞 Contact",      message: "What is the phone number or contact number of InAmigos Foundation?" },
    ];

    followUps.forEach(function (qr) {
      var btn = document.createElement("button");
      btn.className = "iafw-quick-btn";
      btn.textContent = qr.label;
      btn.addEventListener("click", function () {
        handleQuickReply(qr.message, qrContainer);
      });
      qrContainer.appendChild(btn);
    });

    messagesEl.appendChild(qrContainer);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ---- Window open/close ----
  var greeted = false;
  function openWindow() {
    win.classList.add("iafw-open");
    if (!greeted) {
      greeted = true;
      addWelcomeMessage();
    }
    inputEl.focus();
  }
  function closeWindow() {
    win.classList.remove("iafw-open");
  }

  bubble.addEventListener("click", function () {
    if (win.classList.contains("iafw-open")) closeWindow();
    else openWindow();
  });
  closeBtn.addEventListener("click", closeWindow);

  // ---- Sending logic ----
  function setSending(isSending) {
    inputEl.disabled = isSending;
    sendBtn.disabled = isSending;
  }

  function sendMessage(text) {
    if (!text) return;

    addMessage(text, "user");
    inputEl.value = "";
    setSending(true);

    var typingEl = addMessage("Typing...", "typing");

    fetch(API_BASE.replace(/\/$/, "") + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, session_id: getSessionId() }),
    })
      .then(function (res) {
        if (!res.ok) throw new Error("Request failed: " + res.status);
        return res.json();
      })
      .then(function (data) {
        typingEl.remove();
        addMessage(data.reply, "bot");
        // Show follow-up quick replies after every bot response
        showFollowUpReplies();
      })
      .catch(function () {
        typingEl.remove();
        addMessage("Sorry, I couldn't reach the server just now. Please try again in a moment.", "bot");
      })
      .finally(function () {
        setSending(false);
        inputEl.focus();
      });
  }

  function send() {
    var text = inputEl.value.trim();
    sendMessage(text);
  }

  sendBtn.addEventListener("click", send);
  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter") send();
  });
})();
