const envBody = document.getElementById("env-body");
const addBtn = document.getElementById("add-btn");
const saveBtn = document.getElementById("save-btn");
const statusMsg = document.getElementById("status-msg");

let _layerId = null;

const urlParams = new URLSearchParams(window.location.search);
const passkey = urlParams.get("passkey");
if (passkey) {
  const clean = new URL(window.location.href);
  clean.searchParams.delete("passkey");
  window.history.replaceState({}, document.title, clean.pathname + clean.search);
}

function setStatus(text, type = "") {
  statusMsg.textContent = text;
  statusMsg.className = "status " + type;
}

function addRow(key = "", value = "") {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text" class="env-key" placeholder="KEY" value="${escHtml(key)}" /></td>
    <td><input type="text" class="env-value" placeholder="value" value="${escHtml(value)}" /></td>
    <td><button class="remove-btn" title="Remove">✕</button></td>
  `;
  tr.querySelector(".remove-btn").addEventListener("click", () => tr.remove());
  envBody.appendChild(tr);
}

function escHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function getRows() {
  return Array.from(envBody.querySelectorAll("tr")).map((tr) => ({
    key: tr.querySelector(".env-key").value.trim(),
    value: tr.querySelector(".env-value").value,
  })).filter((r) => r.key !== "");
}

addBtn.addEventListener("click", () => addRow());

saveBtn.addEventListener("click", async () => {
  if (!_layerId) { setStatus("Not authenticated.", "error"); return; }
  setStatus("Saving...");
  try {
    const pairs = getRows();
    const res = await fetch("./api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-layer-id": _layerId },
      body: JSON.stringify({ pairs }),
    });
    if (!res.ok) throw new Error(await res.text());
    setStatus("Saved successfully.", "success");
  } catch (err) {
    setStatus("Save failed: " + err.message, "error");
  }
});

async function init() {
  if (!passkey) { setStatus("Missing passkey.", "error"); return; }
  setStatus("Loading...");
  try {
    const res = await fetch(`./api/init?passkey=${encodeURIComponent(passkey)}`);
    if (!res.ok) throw new Error(await res.text());
    const { pairs, layerId } = await res.json();
    _layerId = layerId;
    envBody.innerHTML = "";
    (pairs ?? []).forEach((p) => addRow(p.key, p.value));
    if ((pairs ?? []).length === 0) addRow();
    setStatus("");
  } catch (err) {
    setStatus("Failed to load: " + err.message, "error");
  }
}

init();
