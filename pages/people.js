import {
  api,
  pageHead,
  avatar,
  toast,
  escapeHtml,
  formatDate,
} from "./util.js";

export function renderPeople() {
  return `
    ${pageHead({
      title: "Enrolled People",
      subtitle: "Everyone Visage can recognize. Delete to remove all face samples.",
      actions: `
        <input class="input" id="search" placeholder="Search name, role..." style="max-width:260px;" />
        <a href="#/enroll" class="btn btn-primary">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
          Enroll
        </a>
      `,
    })}
    <div id="people-body"></div>
  `;
}

export async function mountPeople(node) {
  const body = node.querySelector("#people-body");
  const search = node.querySelector("#search");
  let people = [];

  function render(filter = "") {
    const f = filter.trim().toLowerCase();
    const filtered = f
      ? people.filter(
          (p) =>
            (p.name || "").toLowerCase().includes(f) ||
            (p.role || "").toLowerCase().includes(f) ||
            (p.department || "").toLowerCase().includes(f),
        )
      : people;

    if (people.length === 0) {
      body.innerHTML = `
        <div class="glass-panel" style="padding:60px 30px; text-align:center;">
          <div class="empty-icon">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="4"/><path d="M3 21c1.5-3.5 4-5.5 6-5.5s4.5 2 6 5.5"/><path d="M19 8v6"/><path d="M16 11h6"/></svg>
          </div>
          <h4 style="font-weight:600; font-size:18px; margin-top:14px;">No people enrolled yet</h4>
          <p style="color:var(--text-mute); max-width:380px; margin:8px auto 18px; font-size:14px;">
            Enroll your first person to start tracking attendance with face recognition.
          </p>
          <a href="#/enroll" class="btn btn-primary">Enroll first person</a>
        </div>
      `;
      return;
    }

    if (filtered.length === 0) {
      body.innerHTML = `<div class="empty"><h4>No matches</h4><p>Try a different search term.</p></div>`;
      return;
    }

    body.innerHTML = `<div class="people-grid">${filtered
      .map(
        (p) => `
        <div class="person-card glass-card">
          ${avatar(p)}
          <div>
            <div class="person-name">${escapeHtml(p.name)}</div>
            <div class="person-role">${escapeHtml(p.role || "—")}${p.department ? " · " + escapeHtml(p.department) : ""}</div>
          </div>
          <div class="person-meta">
            <span class="badge badge-violet">${p.samples} samples</span>
            <span class="badge">Enrolled ${formatDate(p.enrolled_at)}</span>
          </div>
          <button class="btn btn-ghost" data-delete="${p.id}" style="font-size:12.5px; padding:8px 12px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
            Remove
          </button>
        </div>
      `,
      )
      .join("")}</div>`;

    body.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.delete;
        const person = people.find((p) => p.id === id);
        if (!person) return;
        if (!confirm(`Remove ${person.name} and all their face samples?`)) return;
        try {
          await api(`/srv/people/${id}`, { method: "DELETE" });
          toast(`${person.name} removed`, "success");
          await load();
        } catch (e) {
          toast(e.message, "error");
        }
      });
    });
  }

  async function load() {
    try {
      const res = await api("/srv/people");
      people = res.people;
      render(search.value);
    } catch (e) {
      body.innerHTML = `<div class="empty"><h4>Could not load people</h4><p>${escapeHtml(e.message)}</p></div>`;
    }
  }

  search.addEventListener("input", () => render(search.value));
  await load();
}
