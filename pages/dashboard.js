import {
  api,
  pageHead,
  avatar,
  timeAgo,
  formatTime,
  escapeHtml,
} from "./util.js";

export function renderDashboard() {
  return `
    ${pageHead({
      title: "Dashboard",
      subtitle: "Today's attendance and system overview at a glance.",
      actions: `<a href="#/recognize" class="btn btn-primary">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.5"/><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/></svg>
        Start Recognition
      </a>`,
    })}

    <section class="stat-grid">
      <div class="stat-card feature glass-panel">
        <div class="badge badge-violet" style="align-self:flex-start;">
          <span class="dot ok"></span> Live mode
        </div>
        <div class="stat-value">Mark attendance hands-free.</div>
        <p>
          Open the camera and Visage will detect, identify, and log every
          enrolled face in real time — with confidence scoring and automatic
          duplicate suppression.
        </p>
        <div style="display:flex; gap:10px; margin-top:6px;">
          <a href="#/recognize" class="btn btn-accent">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 4 20 12 6 20 6 4"/></svg>
            Begin scan
          </a>
          <a href="#/enroll" class="btn btn-ghost">Enroll someone</a>
        </div>
      </div>

      <div class="stat-card glass-panel">
        <div class="stat-icon">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="4"/><circle cx="17" cy="9" r="3"/><path d="M2 21c1.5-3.5 4-5.5 7-5.5s5.5 2 7 5.5"/><path d="M14.5 14c1.2-.7 2.6-1 4-1 2 0 3.5 1 5 3"/></svg>
        </div>
        <div>
          <div class="stat-label">Enrolled</div>
          <div class="stat-value" id="stat-enrolled">—</div>
        </div>
      </div>

      <div class="stat-card glass-panel">
        <div class="stat-icon" style="background:linear-gradient(135deg, rgba(52,211,153,.45), rgba(34,211,238,.2));">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>
        </div>
        <div>
          <div class="stat-label">Present today</div>
          <div class="stat-value" id="stat-present">—</div>
        </div>
      </div>
    </section>

    <section class="recent-list glass-panel">
      <div class="recent-head">
        <h3>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px; margin-right:8px;"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
          Recent check-ins
        </h3>
        <a href="#/attendance" class="btn btn-ghost" style="font-size:13px; padding:7px 12px;">View all</a>
      </div>
      <div id="recent-body"></div>
    </section>
  `;
}

export async function mountDashboard() {
  const enrolledEl = document.getElementById("stat-enrolled");
  const presentEl = document.getElementById("stat-present");
  const recentBody = document.getElementById("recent-body");

  try {
    const stats = await api("/srv/stats");
    enrolledEl.textContent = stats.enrolled;
    presentEl.textContent = stats.present_today;
  } catch (e) {
    enrolledEl.textContent = "0";
    presentEl.textContent = "0";
  }

  try {
    const [todayRes, peopleRes] = await Promise.all([
      api("/srv/attendance/today"),
      api("/srv/people"),
    ]);
    const peopleById = Object.fromEntries(
      (peopleRes.people || []).map((p) => [p.id, p]),
    );
    const recent = todayRes.records.slice(0, 8);
    if (recent.length === 0) {
      recentBody.innerHTML = `
        <div class="empty">
          <div class="empty-icon">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
          </div>
          <h4>No check-ins yet today</h4>
          <p>Once recognition starts running, every detected face will appear here in real time.</p>
        </div>
      `;
      return;
    }
    recentBody.innerHTML = recent
      .map((r) => {
        const person = peopleById[r.person_id] || { name: r.name };
        return `
          <div class="recent-row">
            ${avatar(person)}
            <div class="recent-meta">
              <div class="recent-name">${escapeHtml(r.name)}</div>
              <div class="recent-sub">${escapeHtml(r.role || "Attendee")} · ${timeAgo(r.timestamp)}</div>
            </div>
            <div class="recent-time">${formatTime(r.time)}</div>
          </div>
        `;
      })
      .join("");
  } catch (e) {
    recentBody.innerHTML = `<div class="empty"><h4>Could not load attendance</h4><p>${escapeHtml(e.message)}</p></div>`;
  }
}
