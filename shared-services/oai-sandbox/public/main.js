// --- Auth ---
const urlParams = new URLSearchParams(window.location.search);
const passkey = urlParams.get("passkey");
if (passkey) {
  const clean = new URL(window.location.href);
  clean.searchParams.delete("passkey");
  window.history.replaceState({}, document.title, clean.pathname + clean.search);
}

let _layerId = null;

// --- Tabs ---
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove("hidden");
    if (btn.dataset.tab === "jobs") loadJobs();
  });
});

// --- Env Vars Tab ---
const envBody = document.getElementById("env-body");
const statusMsg = document.getElementById("status-msg");

function setStatus(text, type = "") {
  statusMsg.textContent = text;
  statusMsg.className = "status " + type;
}

function escHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function addRow(key = "", value = "") {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text" class="env-key" placeholder="KEY" value="${escHtml(key)}" /></td>
    <td><input type="text" class="env-value" placeholder="setting name" value="${escHtml(value)}" /></td>
    <td><button class="remove-btn" title="Remove">✕</button></td>
  `;
  tr.querySelector(".remove-btn").addEventListener("click", () => tr.remove());
  envBody.appendChild(tr);
}

function getRows() {
  return Array.from(envBody.querySelectorAll("tr")).map((tr) => ({
    key: tr.querySelector(".env-key").value.trim(),
    value: tr.querySelector(".env-value").value,
  })).filter((r) => r.key !== "");
}

document.getElementById("add-btn").addEventListener("click", () => addRow());

document.getElementById("save-btn").addEventListener("click", async () => {
  if (!_layerId) { setStatus("Not authenticated.", "error"); return; }
  setStatus("Saving...");
  try {
    const res = await fetch("./api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-layer-id": _layerId },
      body: JSON.stringify({ pairs: getRows() }),
    });
    if (!res.ok) throw new Error(await res.text());
    setStatus("Saved successfully.", "success");
  } catch (err) {
    setStatus("Save failed: " + err.message, "error");
  }
});

// --- Jobs Tab ---
const jobsStatus = document.getElementById("jobs-status");

function setJobsStatus(text, type = "") {
  jobsStatus.textContent = text;
  jobsStatus.className = "status " + type;
}

function fmtTime(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleTimeString();
}

function shortId(id) {
  return id.slice(0, 8) + "…";
}

async function loadJobs() {
  if (!_layerId) { setJobsStatus("Not authenticated.", "error"); return; }
  setJobsStatus("Loading...");
  try {
    const res = await fetch("./api/jobs", { headers: { "x-layer-id": _layerId } });
    if (!res.ok) throw new Error(await res.text());
    const { jobs } = await res.json();

    const pending = jobs.filter((j) => j.status === "pending");
    const running = jobs.filter((j) => j.status === "running");

    renderPending(pending);
    renderRunning(running);
    setJobsStatus(`${jobs.length} job(s) found`, "");
  } catch (err) {
    setJobsStatus("Failed to load: " + err.message, "error");
  }
}

function renderPending(jobs) {
  const tbody = document.getElementById("pending-body");
  if (!jobs.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-row">No pending jobs</td></tr>`;
    return;
  }
  tbody.innerHTML = jobs.map((j) => `
    <tr>
      <td title="${j.jobId}">${shortId(j.jobId)}</td>
      <td title="${j.sessionId}">${shortId(j.sessionId)}</td>
      <td>${fmtTime(j.enqueuedAt)}</td>
      <td>
        <div class="job-actions">
          <button class="btn ghost" onclick="cancelJob('${j.jobId}')">Cancel</button>
        </div>
      </td>
    </tr>
  `).join("");
}

function renderRunning(jobs) {
  const tbody = document.getElementById("running-body");
  if (!jobs.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-row">No running jobs</td></tr>`;
    return;
  }
  tbody.innerHTML = jobs.map((j) => `
    <tr>
      <td title="${j.jobId}">${shortId(j.jobId)}</td>
      <td title="${j.sessionId}">${shortId(j.sessionId)}</td>
      <td>${fmtTime(j.startedAt)}</td>
      <td>
        <div class="job-actions">
          <button class="btn ghost" onclick="viewOutput('${j.jobId}')">Output</button>
          <button class="btn danger" style="padding:0.3rem 0.7rem;font-size:0.8rem" onclick="confirmStop('${j.jobId}')">Stop</button>
        </div>
      </td>
    </tr>
  `).join("");
}

document.getElementById("refresh-btn").addEventListener("click", loadJobs);

// --- Cancel ---
window.cancelJob = async (jobId) => {
  if (!_layerId) return;
  if (!confirm(`Cancel pending job ${jobId.slice(0, 8)}?`)) return;
  try {
    const res = await fetch(`./api/jobs/${jobId}/cancel`, {
      method: "POST",
      headers: { "x-layer-id": _layerId },
    });
    if (!res.ok) throw new Error(await res.text());
    setJobsStatus("Job cancelled.", "success");
    loadJobs();
  } catch (err) {
    setJobsStatus("Cancel failed: " + err.message, "error");
  }
};

// --- Output modal ---
const outputModal = document.getElementById("output-modal");
document.getElementById("modal-close").addEventListener("click", () => outputModal.classList.add("hidden"));

window.viewOutput = async (jobId) => {
  if (!_layerId) return;
  document.getElementById("output-stdout").textContent = "Loading…";
  document.getElementById("output-stderr").textContent = "Loading…";
  outputModal.classList.remove("hidden");
  try {
    const res = await fetch(`./api/jobs/${jobId}/output`, { headers: { "x-layer-id": _layerId } });
    if (!res.ok) throw new Error(await res.text());
    const { stdout, stderr } = await res.json();
    document.getElementById("output-stdout").textContent = stdout || "(empty)";
    document.getElementById("output-stderr").textContent = stderr || "(empty)";
  } catch (err) {
    document.getElementById("output-stdout").textContent = "Error: " + err.message;
    document.getElementById("output-stderr").textContent = "";
  }
};

// --- Stop modal ---
const stopModal = document.getElementById("stop-modal");
let _pendingStopJobId = null;

document.getElementById("stop-modal-close").addEventListener("click", () => stopModal.classList.add("hidden"));
document.getElementById("stop-modal-cancel").addEventListener("click", () => stopModal.classList.add("hidden"));

window.confirmStop = (jobId) => {
  _pendingStopJobId = jobId;
  stopModal.classList.remove("hidden");
};

document.getElementById("stop-modal-confirm").addEventListener("click", async () => {
  if (!_layerId || !_pendingStopJobId) return;
  stopModal.classList.add("hidden");
  try {
    const res = await fetch(`./api/jobs/${_pendingStopJobId}/stop`, {
      method: "POST",
      headers: { "x-layer-id": _layerId },
    });
    if (!res.ok) throw new Error(await res.text());
    setJobsStatus("Job stopped. The agent was NOT notified — inform it manually.", "");
    loadJobs();
  } catch (err) {
    setJobsStatus("Stop failed: " + err.message, "error");
  }
  _pendingStopJobId = null;
});

// --- Init ---
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
    if (!(pairs ?? []).length) addRow();
    setStatus("");
  } catch (err) {
    setStatus("Failed to load: " + err.message, "error");
  }
}

init();
