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
    .iafw-bubble {
      position: fixed; bottom: 22px; right: 22px; z-index: 999999;
      width: 58px; height: 58px; border-radius: 50%;
      background: ${ACCENT}; color: #fff; border: none; cursor: pointer;
      box-shadow: 0 6px 18px rgba(0,0,0,0.25);
      display: flex; align-items: center; justify-content: center;
      font-size: 26px; font-family: Arial, sans-serif;
      transition: transform 0.15s ease;
    }
    .iafw-bubble:hover { transform: scale(1.06); }

    .iafw-window {
      position: fixed; bottom: 92px; right: 22px; z-index: 999999;
      width: 340px; max-width: calc(100vw - 32px);
      height: 460px; max-height: calc(100vh - 140px);
      background: #fff; border-radius: 14px; overflow: hidden;
      box-shadow: 0 10px 40px rgba(0,0,0,0.3);
      display: none; flex-direction: column;
      font-family: -apple-system, Arial, sans-serif;
    }
    .iafw-window.iafw-open { display: flex; }

    .iafw-header {
      background: ${ACCENT}; color: #fff; padding: 14px 16px;
      font-weight: 700; font-size: 15px; display: flex; justify-content: space-between; align-items: center;
    }
    .iafw-header span.iafw-sub { display: block; font-weight: 400; font-size: 11px; opacity: 0.85; margin-top: 2px; }
    .iafw-close { background: none; border: none; color: #fff; font-size: 18px; cursor: pointer; line-height: 1; }

    .iafw-messages {
      flex: 1; overflow-y: auto; padding: 12px; background: #F8F6F0;
      display: flex; flex-direction: column; gap: 8px;
    }
    .iafw-msg { max-width: 82%; padding: 8px 11px; border-radius: 10px; font-size: 13.5px; line-height: 1.4; }
    .iafw-msg.user { align-self: flex-end; background: ${ACCENT}; color: #fff; border-bottom-right-radius: 2px; }
    .iafw-msg.bot { align-self: flex-start; background: #fff; color: #23281F; border: 1px solid #E4DCC8; border-bottom-left-radius: 2px; }
    .iafw-msg.typing { align-self: flex-start; color: #8a8572; font-style: italic; font-size: 12.5px; }

    .iafw-inputrow { display: flex; border-top: 1px solid #E4DCC8; padding: 8px; gap: 6px; background: #fff; }
    .iafw-input { flex: 1; border: 1px solid #DED2B5; border-radius: 8px; padding: 8px 10px; font-size: 13.5px; outline: none; }
    .iafw-input:focus { border-color: ${ACCENT}; }
    .iafw-send { background: ${ACCENT_LIGHT}; color: #182B45; border: none; border-radius: 8px; padding: 0 14px; font-weight: 700; cursor: pointer; font-size: 13px; }
    .iafw-send:disabled { opacity: 0.5; cursor: default; }
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
      <div>${ORG_NAME}<span class="iafw-sub">Ask me anything — I usually reply instantly</span></div>
      <button class="iafw-close" aria-label="Close chat">&times;</button>
    </div>
    <div class="iafw-messages"></div>
    <div class="iafw-inputrow">
      <input class="iafw-input" type="text" placeholder="Type a message..." />
      <button class="iafw-send">Send</button>
    </div>
  `;

  document.body.appendChild(bubble);
  document.body.appendChild(win);

  var messagesEl = win.querySelector(".iafw-messages");
  var inputEl = win.querySelector(".iafw-input");
  var sendBtn = win.querySelector(".iafw-send");
  var closeBtn = win.querySelector(".iafw-close");

  function addMessage(text, role) {
    var el = document.createElement("div");
    el.className = "iafw-msg " + role;
    el.textContent = text;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  var greeted = false;
  function openWindow() {
    win.classList.add("iafw-open");
    if (!greeted) {
      greeted = true;
      addMessage("Hi! 👋 I'm the " + ORG_NAME + " assistant. Ask me about donating, volunteering, internships, or our programs.", "bot");
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

  function setSending(isSending) {
    inputEl.disabled = isSending;
    sendBtn.disabled = isSending;
  }

  function send() {
    var text = inputEl.value.trim();
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

  sendBtn.addEventListener("click", send);
  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter") send();
  });
})();
