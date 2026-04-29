import {
  api,
  pageHead,
  startWebcam,
  captureFrame,
  toast,
  escapeHtml,
  avatar,
  formatTime,
  confidenceClass,
} from "./util.js";

export function renderRecognize() {
  return `
    ${pageHead({
      title: "Live Recognition",
      subtitle: "Faces are matched against trained samples and logged automatically.",
      actions: `
        <button class="btn btn-ghost" id="toggle-mark">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>
          Auto-mark: <strong id="mark-state" style="margin-left:6px;">on</strong>
        </button>
        <button class="btn btn-primary" id="play-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 4 20 12 6 20 6 4"/></svg>
          <span id="play-label">Start</span>
        </button>
      `,
    })}

    <section class="live-grid">
      <div class="cam-wrap">
        <video id="rec-video" autoplay playsinline muted></video>
        <canvas id="rec-overlay"></canvas>
        <div class="cam-overlay"></div>
        <div class="scan-line" id="scan-line" style="display:none;"></div>
        <div class="cam-status">
          <span class="dot" id="rec-dot"></span>
          <span id="rec-status">Press Start to begin scanning</span>
        </div>
        <div class="cam-placeholder" id="rec-placeholder"></div>
      </div>

      <div class="feed glass-panel">
        <div class="recent-head" style="margin-bottom:8px;">
          <h3 style="text-transform:uppercase; letter-spacing:.16em; font-size:11px; color:var(--text-soft); margin:0;">Live activity</h3>
          <span class="badge" id="feed-counter">0 today</span>
        </div>
        <div id="feed-body">
          <div class="empty" style="padding:30px 10px;">
            <div class="empty-icon">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
            </div>
            <h4>Waiting for first match</h4>
            <p>Recognized faces will appear here in real time.</p>
          </div>
        </div>
      </div>
    </section>
  `;
}

export async function mountRecognize(node) {
  const video = node.querySelector("#rec-video");
  const overlay = node.querySelector("#rec-overlay");
  const placeholder = node.querySelector("#rec-placeholder");
  const playBtn = node.querySelector("#play-btn");
  const playLabel = node.querySelector("#play-label");
  const toggleMark = node.querySelector("#toggle-mark");
  const markState = node.querySelector("#mark-state");
  const status = node.querySelector("#rec-status");
  const statusDot = node.querySelector("#rec-dot");
  const feedBody = node.querySelector("#feed-body");
  const feedCounter = node.querySelector("#feed-counter");
  const scanLine = node.querySelector("#scan-line");

  let cam = null;
  let timer = null;
  let running = false;
  let autoMark = true;
  let recentMarks = [];
  let todayCount = 0;

  // Pre-load today's count.
  try {
    const today = await api("/srv/attendance/today");
    todayCount = new Set(today.records.map((r) => r.person_id)).size;
    feedCounter.textContent = `${todayCount} today`;
  } catch {
    /* ignore */
  }

  function drawFaces(faces, srcW, srcH) {
    const rect = video.getBoundingClientRect();
    overlay.width = rect.width * devicePixelRatio;
    overlay.height = rect.height * devicePixelRatio;
    overlay.style.width = rect.width + "px";
    overlay.style.height = rect.height + "px";
    const ctx = overlay.getContext("2d");
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (!faces || !srcW) return;
    const sx = rect.width / srcW;
    const sy = rect.height / srcH;
    for (const f of faces) {
      const known = !!f.person_id;
      const color = known
        ? "rgba(52,211,153,.95)"
        : "rgba(251,113,133,.95)";
      const x = f.x * sx;
      const y = f.y * sy;
      const w = f.w * sx;
      const h = f.h * sy;
      const r = 14;

      ctx.lineWidth = 2.5;
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;

      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      ctx.stroke();

      // Label pill - drawn UNFLIPPED so text reads correctly.
      ctx.shadowBlur = 0;
      ctx.save();
      // Counter the parent's mirror by flipping again on horizontal text origin.
      const labelW = ctx.measureText(f.label).width + 60;
      const lx = x;
      const ly = y - 30;

      ctx.translate(lx + labelW, ly);
      ctx.scale(-1, 1);
      ctx.fillStyle = known
        ? "rgba(15, 23, 42, .85)"
        : "rgba(40, 8, 16, .85)";
      const pillH = 24;
      ctx.beginPath();
      ctx.roundRect(0, 0, labelW, pillH, 12);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = "600 12px Outfit, system-ui";
      const conf = Math.round(f.confidence || 0);
      ctx.fillText(`${f.label}  ${conf}%`, 12, 16);
      ctx.restore();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function appendMarks(marks) {
    if (!marks || marks.length === 0) return;
    if (recentMarks.length === 0) feedBody.innerHTML = "";
    for (const m of marks) {
      recentMarks.unshift(m);
      const conf = parseFloat(m.confidence) || 0;
      const row = document.createElement("div");
      row.className = "feed-row";
      row.innerHTML = `
        <div class="avatar avatar-fallback">${escapeHtml((m.name || "?").slice(0,1).toUpperCase())}</div>
        <div class="recent-meta">
          <div class="name">${escapeHtml(m.name)}</div>
          <div class="when">${escapeHtml(m.role || "Attendee")} · ${formatTime(m.time)}</div>
        </div>
        <span class="conf ${confidenceClass(conf)}">${Math.round(conf)}%</span>
      `;
      feedBody.prepend(row);
      todayCount = todayCount + (m._new ? 0 : 1);
    }
    todayCount += marks.length;
    feedCounter.textContent = `${todayCount} today`;
    // Cap visible rows.
    while (feedBody.children.length > 25) {
      feedBody.lastChild?.remove();
    }
  }

  async function tick() {
    if (!running || !video.videoWidth) return;
    const data = captureFrame(video, 480);
    if (!data) return;
    try {
      const res = await api("/srv/recognize", {
        method: "POST",
        body: JSON.stringify({ image: data, auto_mark: autoMark }),
      });
      drawFaces(res.faces, res.width, res.height);
      if (res.marked && res.marked.length) {
        appendMarks(res.marked);
      }
      if (!res.model_ready) {
        status.textContent = "Train at least one face on the Enroll page";
        statusDot.classList.add("err");
      } else {
        const known = res.faces.filter((f) => f.person_id).length;
        if (res.faces.length === 0) {
          status.textContent = "Scanning...";
          statusDot.classList.remove("err");
          statusDot.classList.add("ok");
        } else if (known > 0) {
          status.textContent = `Identified · ${known} match${known > 1 ? "es" : ""}`;
          statusDot.classList.add("ok");
          statusDot.classList.remove("err");
        } else {
          status.textContent = `${res.faces.length} face(s) · unknown`;
          statusDot.classList.remove("ok");
          statusDot.classList.add("err");
        }
      }
    } catch (e) {
      status.textContent = e.message;
    }
  }

  async function start() {
    try {
      cam = await startWebcam(video);
      placeholder.style.display = "none";
      running = true;
      scanLine.style.display = "block";
      playLabel.textContent = "Stop";
      playBtn.classList.remove("btn-primary");
      playBtn.classList.add("btn-danger");
      status.textContent = "Scanning...";
      statusDot.classList.add("ok");
      timer = setInterval(tick, 700);
    } catch (e) {
      placeholder.innerHTML = `
        <div>
          <div class="empty-icon" style="margin-bottom:12px;">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l22 22"/><path d="M5 7H3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12"/><path d="M22 8l-5 5"/></svg>
          </div>
          <strong style="color:var(--text);">Camera blocked</strong><br/>
          Allow camera access to begin recognition.
        </div>
      `;
      status.textContent = "Camera unavailable";
      statusDot.classList.add("err");
    }
  }

  function stop() {
    running = false;
    if (timer) clearInterval(timer);
    timer = null;
    if (cam) {
      cam.stop();
      cam = null;
    }
    scanLine.style.display = "none";
    playLabel.textContent = "Start";
    playBtn.classList.add("btn-primary");
    playBtn.classList.remove("btn-danger");
    status.textContent = "Stopped";
    statusDot.classList.remove("ok", "err");
    const ctx = overlay.getContext("2d");
    ctx.clearRect(0, 0, overlay.width, overlay.height);
  }

  playBtn.addEventListener("click", () => (running ? stop() : start()));
  toggleMark.addEventListener("click", () => {
    autoMark = !autoMark;
    markState.textContent = autoMark ? "on" : "off";
    toast(`Auto-mark ${autoMark ? "enabled" : "disabled"}`, "info", 1400);
  });

  return () => {
    stop();
  };
}
