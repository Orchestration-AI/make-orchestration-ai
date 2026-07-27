const urlParams = new URLSearchParams(window.location.search);
const passkey = urlParams.get("passkey");
if (passkey) {
  const clean = new URL(window.location.href);
  clean.searchParams.delete("passkey");
  window.history.replaceState({}, document.title, clean.pathname + clean.search);
}

let contacts = [];
let agents = []; // { id, name }
let editingId = null;
let pendingMembers = []; // { agentId, name }

// ── Status ────────────────────────────────────────────────────────────────────

function setStatus(text, type = "") {
  const el = document.getElementById("status-msg");
  el.textContent = text;
  el.className = "status " + type;
}

// ── Render table ──────────────────────────────────────────────────────────────

function renderTable() {
  const tbody = document.getElementById("contacts-body");
  tbody.innerHTML = "";
  if (contacts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-row">No contacts yet.</td></tr>`;
    return;
  }

  for (const c of contacts) {
    const tr = document.createElement("tr");
    const agentCol = c.type === "group"
      ? (c.members ?? []).map((m) => m.name).join(", ") || "-"
      : c.id ?? "-";

    tr.innerHTML = `
      <td>${esc(c.name)}</td>
      <td><span class="badge badge-${c.type}">${c.type}</span></td>
      <td>${esc(c.email ?? "-")}</td>
      <td>${esc(c.phone ?? "-")}</td>
      <td>${esc(agentCol)}</td>
      <td>
        <button class="action-btn" data-edit="${c.id}">Edit</button>
        <button class="action-btn delete" data-delete="${c.id}">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openModal(btn.dataset.edit))
  );
  tbody.querySelectorAll("[data-delete]").forEach((btn) =>
    btn.addEventListener("click", () => deleteContact(btn.dataset.delete))
  );
}

function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

// ── Agent dropdowns ───────────────────────────────────────────────────────────

function populateAgentDropdowns() {
  const agentSel = document.getElementById("field-agent");
  const memberSel = document.getElementById("member-add-select");
  [agentSel, memberSel].forEach((sel) => {
    const first = sel.options[0];
    sel.innerHTML = "";
    sel.appendChild(first);
    for (const a of agents) {
      const opt = document.createElement("option");
      opt.value = a.id;
      opt.textContent = a.name ?? a.id;
      sel.appendChild(opt);
    }
  });
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function openModal(editId = null) {
  editingId = editId;
  pendingMembers = [];
  const contact = editId ? contacts.find((c) => c.id === editId) : null;

  document.getElementById("modal-title").textContent = editId ? "Edit Contact" : "Add Contact";
  document.getElementById("field-id").value = contact?.id ?? "";
  document.getElementById("field-name").value = contact?.name ?? "";
  document.getElementById("field-description").value = contact?.description ?? "";
  document.getElementById("field-type").value = contact?.type ?? "individual";
  document.getElementById("field-email").value = contact?.email ?? "";
  document.getElementById("field-phone").value = contact?.phone ?? "";
  document.getElementById("field-agent").value = contact?.type === "individual" ? (contact.id ?? "") : "";

  if (contact?.type === "group") {
    pendingMembers = [...(contact.members ?? [])];
  }

  toggleTypeSections(contact?.type ?? "individual");
  renderMemberTags();
  document.getElementById("modal-overlay").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
  editingId = null;
  pendingMembers = [];
}

function toggleTypeSections(type) {
  const isGroup = type === "group";
  document.getElementById("individual-section").classList.toggle("hidden", isGroup);
  document.getElementById("group-section").classList.toggle("hidden", !isGroup);
}

document.getElementById("field-type").addEventListener("change", (e) => {
  const isGroup = e.target.value === "group";
  toggleTypeSections(e.target.value);
  if (isGroup) {
    document.getElementById("field-email").value = "";
    document.getElementById("field-phone").value = "";
  }
});

function renderMemberTags() {
  const container = document.getElementById("member-list");
  container.innerHTML = "";
  for (const m of pendingMembers) {
    const tag = document.createElement("span");
    tag.className = "member-tag";
    tag.innerHTML = `${esc(m.name ?? m.agentId)} <button data-id="${m.agentId}">✕</button>`;
    tag.querySelector("button").addEventListener("click", () => {
      pendingMembers = pendingMembers.filter((x) => x.agentId !== m.agentId);
      renderMemberTags();
    });
    container.appendChild(tag);
  }
}

document.getElementById("member-add-btn").addEventListener("click", () => {
  const sel = document.getElementById("member-add-select");
  const agentId = sel.value;
  if (!agentId) return;
  if (pendingMembers.find((m) => m.agentId === agentId)) return;
  const agent = agents.find((a) => a.id === agentId);
  pendingMembers.push({ agentId, name: agent?.name ?? agentId });
  sel.value = "";
  renderMemberTags();
});

document.getElementById("modal-close").addEventListener("click", closeModal);
document.getElementById("cancel-btn").addEventListener("click", closeModal);

// ── Save ──────────────────────────────────────────────────────────────────────

document.getElementById("contact-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const saveBtn = document.getElementById("save-btn");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";

  try {
    const type = document.getElementById("field-type").value;
    const agentId = document.getElementById("field-agent").value;

    const contact = {
      id: type === "individual" && agentId
        ? agentId
        : (document.getElementById("field-id").value || crypto.randomUUID()),
      name: document.getElementById("field-name").value.trim(),
      description: document.getElementById("field-description").value.trim(),
      type,
      email: document.getElementById("field-email").value.trim() || undefined,
      phone: document.getElementById("field-phone").value.trim() || undefined,
      ...(type === "group" ? { members: pendingMembers } : {}),
    };

    if (editingId) {
      const idx = contacts.findIndex((c) => c.id === editingId);
      if (idx !== -1) contacts[idx] = contact;
    } else {
      contacts.push(contact);
    }

    await saveContacts();
    closeModal();
    renderTable();
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save";
  }
});

// ── Delete ────────────────────────────────────────────────────────────────────

async function deleteContact(id) {
  if (!confirm("Delete this contact?")) return;
  contacts = contacts.filter((c) => c.id !== id);
  await saveContacts();
  renderTable();
}

// ── Persist ───────────────────────────────────────────────────────────────────

async function saveContacts() {
  try {
    const res = await fetch("./api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passkey, contacts }),
    });
    if (!res.ok) throw new Error(await res.text());
    setStatus("Saved.", "success");
    setTimeout(() => setStatus(""), 2000);
  } catch (err) {
    setStatus("Save failed: " + err.message, "error");
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.getElementById("add-btn").addEventListener("click", () => openModal());

async function init() {
  if (!passkey) { setStatus("Missing passkey.", "error"); return; }
  setStatus("Loading…");
  try {
    const [contactsRes, agentsRes] = await Promise.all([
      fetch(`./api/init?passkey=${encodeURIComponent(passkey)}`),
      fetch(`./api/agents?passkey=${encodeURIComponent(passkey)}`),
    ]);
    if (!contactsRes.ok) throw new Error(await contactsRes.text());
    if (!agentsRes.ok) throw new Error(await agentsRes.text());

    contacts = (await contactsRes.json()).contacts ?? [];
    agents = (await agentsRes.json()).agents ?? [];

    populateAgentDropdowns();
    renderTable();
    document.getElementById("app").classList.remove("hidden");
    document.getElementById("load-status").textContent = "";
    setStatus("");
  } catch (err) {
    document.getElementById("load-status").textContent = "Failed to load: " + err.message;
    document.getElementById("load-status").className = "status center-status error";
  }
}

init();
