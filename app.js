// Visage — Face Recognition Attendance frontend
// Vanilla JS hash-based router + small render helpers.

import { renderDashboard, mountDashboard } from "./pages/dashboard.js";
import { renderEnroll, mountEnroll } from "./pages/enroll.js";
import { renderRecognize, mountRecognize } from "./pages/recognize.js";
import { renderPeople, mountPeople } from "./pages/people.js";
import { renderAttendance, mountAttendance } from "./pages/attendance.js";
import { api, toast } from "./pages/util.js";

const routes = {
  "/": { render: renderDashboard, mount: mountDashboard, title: "Dashboard" },
  "/recognize": {
    render: renderRecognize,
    mount: mountRecognize,
    title: "Live Recognition",
  },
  "/enroll": {
    render: renderEnroll,
    mount: mountEnroll,
    title: "Enroll Person",
  },
  "/people": {
    render: renderPeople,
    mount: mountPeople,
    title: "Enrolled People",
  },
  "/attendance": {
    render: renderAttendance,
    mount: mountAttendance,
    title: "Attendance Log",
  },
};

let currentCleanup = null;

function getPath() {
  const hash = window.location.hash.replace(/^#/, "");
  return hash || "/";
}

async function navigate() {
  const path = getPath();
  const route = routes[path] || routes["/"];

  if (typeof currentCleanup === "function") {
    try {
      currentCleanup();
    } catch (e) {
      console.warn("cleanup err", e);
    }
    currentCleanup = null;
  }

  const root = document.getElementById("route-root");
  root.innerHTML = "";
  const node = document.createElement("div");
  node.className = "fade-in";
  node.innerHTML = route.render();
  root.appendChild(node);

  // Update active nav link.
  document.querySelectorAll(".nav-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.route === path);
  });

  // Mount handlers.
  if (typeof route.mount === "function") {
    currentCleanup = await route.mount(node);
  }

  document.title = `${route.title} · Visage`;
  window.scrollTo({ top: 0, behavior: "instant" });
}

window.addEventListener("hashchange", navigate);
window.addEventListener("DOMContentLoaded", async () => {
  navigate();
  // Keep system status in sidebar fresh.
  const refreshStatus = async () => {
    try {
      const res = await api("/srv/health");
      const dot = document.getElementById("model-dot");
      const txt = document.getElementById("model-status");
      if (!dot || !txt) return;
      if (res.model_trained) {
        dot.classList.add("ok");
        dot.classList.remove("err");
        txt.textContent = `Model ready · ${res.people} enrolled`;
      } else if (res.people > 0) {
        dot.classList.remove("ok", "err");
        txt.textContent = "Training...";
      } else {
        dot.classList.remove("ok", "err");
        txt.textContent = "No people enrolled";
      }
    } catch (e) {
      const dot = document.getElementById("model-dot");
      const txt = document.getElementById("model-status");
      if (dot) {
        dot.classList.remove("ok");
        dot.classList.add("err");
      }
      if (txt) txt.textContent = "Backend offline";
    }
  };
  refreshStatus();
  setInterval(refreshStatus, 10000);
});

// Expose toast globally for debugging.
window.toast = toast;
