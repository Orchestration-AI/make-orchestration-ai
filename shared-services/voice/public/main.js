const messagesEl = document.getElementById("messages");
const statusEl = document.getElementById("msg");
const promptInput = document.getElementById("prompt");
const micButton = document.getElementById("mic-button");
const sendButton = document.getElementById("send-button");
const ttsToggle = document.getElementById("tts-toggle");
const voiceSelect = document.getElementById("voice-select");

// --- Voice selector ---
function populateVoices() {
  const voices = speechSynthesis.getVoices();
  voiceSelect.innerHTML = "";
  voices.forEach((v, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `${v.name} (${v.lang})`;
    if (v.default) opt.selected = true;
    voiceSelect.appendChild(opt);
  });
}
speechSynthesis.onvoiceschanged = populateVoices;
populateVoices();

// --- Typing indicator ---
let typingEl = null;

function showTyping() {
  if (typingEl) return;
  typingEl = document.createElement("div");
  typingEl.className = "msg agent typing-bubble";
  typingEl.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  messagesEl.appendChild(typingEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function hideTyping() {
  if (typingEl) { typingEl.remove(); typingEl = null; }
}

// --- Strip markdown for TTS ---
function stripMarkdown(text) {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/#{1,6}\s?/g, "")
    .replace(/[*_~]{1,3}/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/>\s?/g, "")
    .replace(/[-*+]\s/g, "")
    .replace(/\n{2,}/g, ". ")
    .trim();
}

// --- Messages ---
function addMessage(text, type) {
  const div = document.createElement("div");
  div.className = `msg ${type}`;
  if (type === "agent") {
    div.innerHTML = marked.parse(text);
  } else {
    div.textContent = text;
  }
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setStatus(text) {
  statusEl.textContent = text;
  statusEl.classList.toggle("connecting", connecting && !!text);
}

// --- TTS ---
function speak(text) {
  if (!ttsToggle.checked) return;
  const plain = stripMarkdown(text);
  const msg = new SpeechSynthesisUtterance(plain);
  const voices = speechSynthesis.getVoices();
  const selected = voices[voiceSelect.value];
  if (selected) msg.voice = selected;
  msg.rate = 1;
  window.speechSynthesis.speak(msg);
}

// --- WebSocket streaming chat ---
let chat = null;
let connecting = true;
let pendingMessages = [];

function openStreamingChat(agentId, layerIndex, events, config) {
  const base = config.engineUrl.replace(/^http/, "ws");
  const token = config.accessKey || "";
  const url = `${base}/agents/${agentId}/layers/${layerIndex}/ws?token=${encodeURIComponent(token)}`;

  const ws = new WebSocket(url);
  let fullText = "";

  ws.onopen = () => { if (events.onOpen) events.onOpen(); };
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    switch (msg.channel) {
      case "response":
        fullText += msg.data;
        if (events.onChunk) events.onChunk(msg.data);
        break;
      case "response_end":
        if (events.onResponse) events.onResponse(fullText);
        fullText = "";
        break;
      case "response_cancelled":
        fullText = "";
        break;
      case "error":
        fullText = "";
        if (events.onError) events.onError(msg.data);
        break;
    }
  };
  ws.onclose = () => { if (events.onClose) events.onClose(); };
  ws.onerror = () => { if (events.onError) events.onError("WebSocket error"); };

  return {
    send(message) { fullText = ""; ws.send(JSON.stringify({ message })); },
    cancel() { ws.send(JSON.stringify({ type: "cancel" })); },
    close() { ws.close(); },
  };
}

// --- Init: get config and connect directly to engine ---
const _urlParams = new URLSearchParams(window.location.search);
const _passkey = _urlParams.get("passkey");
if (_passkey) {
  const _cleanUrl = new URL(window.location.href);
  _cleanUrl.searchParams.delete("passkey");
  window.history.replaceState({}, document.title, _cleanUrl.pathname + _cleanUrl.search);
}

async function initChat() {
  if (!_passkey) {
    setStatus("Missing passkey");
    return;
  }
  setStatus("Connecting...");

  const res = await fetch(`./api/init?passkey=${encodeURIComponent(_passkey)}`);
  if (!res.ok) {
    setStatus("Failed to connect");
    return;
  }
  const { agentId, layerIndex, accessKey, engineUrl } = await res.json();

  chat = openStreamingChat(agentId, layerIndex, {
    onChunk: () => {},
    onResponse: (fullText) => {
      hideTyping();
      addMessage(fullText, "agent");
      setStatus("");
      speak(fullText);
    },
    onError: (err) => {
      hideTyping();
      setStatus("Error: " + err);
    },
    onOpen: () => {
      connecting = false;
      setStatus("");
      pendingMessages.forEach((m) => sendMessageToAgent(m));
      pendingMessages = [];
    },
    onClose: () => {
      setStatus("Disconnected");
      chat = null;
    },
  }, { accessKey, engineUrl });
}

initChat();

// --- Send ---
function sendMessageToAgent(message) {
  if (!message.trim()) return;
  if (connecting) {
    addMessage(message, "user");
    pendingMessages.push(message);
    return;
  }
  if (!chat) { setStatus("Not connected"); return; }
  addMessage(message, "user");
  showTyping();
  setStatus("Processing...");
  chat.send(message);
}

sendButton.addEventListener("click", () => {
  sendMessageToAgent(promptInput.value);
  promptInput.value = "";
  autoResize();
});

promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessageToAgent(promptInput.value);
    promptInput.value = "";
    autoResize();
  }
});

// Auto-resize textarea
function autoResize() {
  promptInput.style.height = "auto";
  promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + "px";
}
promptInput.addEventListener("input", autoResize);

// --- Voice Typing (Web Speech API) ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isListening = false;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.addEventListener("result", (event) => {
    const transcript = event.results[0][0].transcript;
    sendMessageToAgent(transcript);
  });

  recognition.addEventListener("end", () => {
    isListening = false;
    micButton.classList.remove("active");
    setStatus("");
  });

  recognition.addEventListener("error", () => {
    isListening = false;
    micButton.classList.remove("active");
    setStatus("");
  });

  micButton.addEventListener("click", () => {
    if (isListening) {
      recognition.stop();
    } else {
      recognition.start();
      isListening = true;
      micButton.classList.add("active");
      setStatus("Listening...");
    }
  });
} else {
  micButton.style.display = "none";
}
