const socket = io(window.location.origin, {
  path: "/hooks/voice-io",
});

function addToMessages(message) {
  const element = document.getElementById("messages");
  element.innerHTML = `${element.innerHTML}<p>${message}</p>`;
}

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

const recognition = new SpeechRecognition();
recognition.continuous = true;

function setStatus(text) {
  document.getElementById("msg").innerHTML = text;
}

function speak(text) {
  const msg = new SpeechSynthesisUtterance();
  msg.text = text;
  msg.volume = 1;
  msg.rate = 1;
  msg.pitch = 1;
  window.speechSynthesis.speak(msg);
}

socket.on("message", (message) => {
  addToMessages(message.message);
  setStatus("Speech Paused");
  speak(message.message);
});

async function sendMessageToAgent(message) {
  addToMessages(message);
  setStatus("Processing...");
  recognition.stop();
  const url = new URL(window.location.href);
  const layerId = url.searchParams.get("layerId");
  socket.emit("message", { message, layerId });
}

recognition.addEventListener("result", (event) => {
  const message = event.results[event.resultIndex][0].transcript;
  sendMessageToAgent(message);
});

const startButton = document.getElementById("start-button");
const stopButton = document.getElementById("stop-button");
const promptInput = document.getElementById("prompt");

startButton.addEventListener("click", () => {
  recognition.start();
  setStatus("Speech Enabled");
});

stopButton.addEventListener("click", () => {
  recognition.stop();
  setStatus("Speech Paused");
});

promptInput.addEventListener("keydown", async (event) => {
  if ((event.keyCode == 10 || event.keyCode == 13) && event.ctrlKey) {
    await sendMessageToAgent(event.target.value);
    event.target.value = '';
  } else {
    // Not the key combination we want to submit. So ignore.
  }
});