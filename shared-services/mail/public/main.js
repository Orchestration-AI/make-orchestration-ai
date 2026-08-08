// --- Auth ---
const urlParams = new URLSearchParams(window.location.search);
const passkey = urlParams.get("passkey");
if (passkey) {
  const clean = new URL(window.location.href);
  clean.searchParams.delete("passkey");
  window.history.replaceState({}, document.title, clean.pathname + clean.search);
}

let _passkey = passkey;

// --- Tabs ---
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove("hidden");
  });
});

// --- Status helpers ---
function setStatus(id, text, type = "") {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = "status " + type;
}

// --- SMTP test ---
document.getElementById("test-smtp-btn").addEventListener("click", async () => {
  if (!_passkey) return;
  setStatus("smtp-status", "Sending test email…");
  document.getElementById("test-smtp-btn").disabled = true;
  try {
    const res = await fetch("./api/test-smtp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passkey: _passkey }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error ?? res.statusText);
    setStatus("smtp-status", "✓ Test email sent successfully.", "success");
  } catch (err) {
    setStatus("smtp-status", "✗ " + err.message, "error");
  } finally {
    document.getElementById("test-smtp-btn").disabled = false;
  }
});

// --- IMAP test ---
document.getElementById("test-imap-btn").addEventListener("click", async () => {
  if (!_passkey) return;
  setStatus("imap-status", "Connecting…");
  document.getElementById("test-imap-btn").disabled = true;
  try {
    const res = await fetch("./api/test-imap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passkey: _passkey }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error ?? res.statusText);
    setStatus("imap-status", "✓ IMAP connection successful.", "success");
  } catch (err) {
    setStatus("imap-status", "✗ " + err.message, "error");
  } finally {
    document.getElementById("test-imap-btn").disabled = false;
  }
});

// --- Init ---
async function init() {
  if (!passkey) { setStatus("smtp-status", "Missing passkey.", "error"); return; }
  setStatus("smtp-status", "Loading…");
  try {
    const res = await fetch(`./api/init?passkey=${encodeURIComponent(passkey)}`);
    if (!res.ok) throw new Error(await res.text());
    const { settings } = await res.json();

    // Populate SMTP card
    document.getElementById("smtp-host").textContent = settings.smtpHost || "(not set)";
    document.getElementById("smtp-port").textContent = settings.smtpPort || "(not set)";
    document.getElementById("smtp-user").textContent = settings.smtpUser || "(not set)";
    document.getElementById("smtp-secure").textContent = settings.smtpSecure ? "Yes" : "No";
    document.getElementById("smtp-from").textContent = settings.smtpFrom || "(not set)";

    // Populate IMAP card
    document.getElementById("imap-host").textContent = settings.imapHost || "(not set)";
    document.getElementById("imap-port").textContent = settings.imapPort || "(not set)";
    document.getElementById("imap-user").textContent = settings.imapUser || "(not set)";
    document.getElementById("imap-secure").textContent = settings.imapSecure ? "Yes" : "No";

    document.getElementById("test-smtp-btn").disabled = !settings.smtpHost;
    document.getElementById("test-imap-btn").disabled = !settings.imapHost;

    setStatus("smtp-status", "");
  } catch (err) {
    setStatus("smtp-status", "Failed to load: " + err.message, "error");
  }
}

init();
