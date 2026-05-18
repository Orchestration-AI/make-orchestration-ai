const socket = io(window.location.origin, { path: "/hooks/voice-io" });

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

// --- Socket ---
socket.on("message", (data) => {
  hideTyping();
  addMessage(data.message, "agent");
  setStatus("");
  speak(data.message);
});

// --- Send ---
// --- Remove passkey from URL after load ---
const _urlParams = new URLSearchParams(window.location.search);
const _passkey = _urlParams.get("passkey");
if (_passkey) {
  const _cleanUrl = new URL(window.location.href);
  _cleanUrl.searchParams.delete("passkey");
  window.history.replaceState({}, document.title, _cleanUrl.pathname + _cleanUrl.search);
}

async function sendMessageToAgent(message) {
  if (!message.trim()) return;
  addMessage(message, "user");
  showTyping();
  setStatus("Processing...");
  socket.emit("message", { message, passkey: _passkey });
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
