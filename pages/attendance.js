import {
  api,
  pageHead,
  escapeHtml,
  formatTime,
  formatDate,
  confidenceClass,
} from "./util.js";

export function renderAttendance() {
  return `
    ${pageHead({
      title: "Attendance Log",
      subtitle: "Filter by date or person and export to CSV anytime.",
      actions: `
        <a href="/srv/attendance/export" class="btn btn-accent">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export CSV
        </a>
      `,
    })}

    <div class="panel glass-panel" style="padding:18px 18px 8px;">
      <div class="toolbar" style="margin-bottom:14px;">
        <div class="field">
          <label class="field-label" for="from">From</label>
          <input class="input" type="date" id="from" />
        </div>
        <div class="field">
          <label class="field-label" for="to">To</label>
          <input class="input" type="date" id="to" />
        </div>
        <div class="field" style="flex:1; min-width:200px;">
          <label class="field-label" for="search">Person</label>
          <input class="input" id="search" placeholder="Search name or role" />
        </div>
        <button class="btn btn-ghost" id="reset">Reset filters</button>
      </div>

      <div id="att-body"></div>
    </div>
  `;
}

export async function mountAttendance(node) {
  const fromEl = node.querySelector("#from");
  const toEl = node.querySelector("#to");
  const search = node.querySelector("#search");
  const reset = node.querySelector("#reset");
  const body = node.querySelector("#att-body");
  let records = [];

  function render() {
    const from = fromEl.value;
    const to = toEl.value;
    const q = search.value.trim().toLowerCase();
    const filtered = records.filter((r) => {
      if (from && r.date < from) return false;
      if (to && r.date > to) return false;
      if (q) {
        const hay = (r.name + " " + (r.role || "")).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      body.innerHTML = `
        <div class="empty">
          <div class="empty-icon">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
          </div>
          <h4>${records.length === 0 ? "No attendance records" : "No matches"}</h4>
          <p>${records.length === 0 ? "Records will appear here once recognition starts marking attendance." : "Try widening the date range or clearing the search."}</p>
        </div>
      `;
      return;
    }

    body.innerHTML = `
      <div style="display:flex; gap:10px; margin-bottom:10px; flex-wrap:wrap;">
        <span class="badge badge-violet">${filtered.length} record${filtered.length === 1 ? "" : "s"}</span>
        <span class="badge">${new Set(filtered.map((r) => r.person_id)).size} unique people</span>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Date</th>
              <th>Time</th>
              <th>Confidence</th>
              <th>Record ID</th>
            </tr>
          </thead>
          <tbody>
            ${filtered
              .map(
                (r) => `
              <tr>
                <td><strong>${escapeHtml(r.name)}</strong></td>
                <td>${escapeHtml(r.role || "—")}</td>
                <td>${escapeHtml(formatDate(r.date))}</td>
                <td class="mono">${escapeHtml(formatTime(r.time))}</td>
                <td><span class="conf-pill ${confidenceClass(parseFloat(r.confidence) || 0)}">${Math.round(parseFloat(r.confidence) || 0)}%</span></td>
                <td class="mono" style="color:var(--text-mute);">${escapeHtml(r.id)}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  fromEl.addEventListener("change", render);
  toEl.addEventListener("change", render);
  search.addEventListener("input", render);
  reset.addEventListener("click", () => {
    fromEl.value = "";
    toEl.value = "";
    search.value = "";
    render();
  });

  try {
    const res = await api("/srv/attendance");
    records = res.records;
    render();
  } catch (e) {
    body.innerHTML = `<div class="empty"><h4>Could not load attendance</h4><p>${escapeHtml(e.message)}</p></div>`;
  }
}
