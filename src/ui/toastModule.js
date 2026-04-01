/* =========================================================
   src/ui/toastModule.js
   Encapsulates the toast notification system.
   Exposes window.showToast globally for messaging.js compat.
   ========================================================= */

const container = document.getElementById("toastContainer");

/**
 * Display a slide-in toast notification.
 * @param {string} title   - Bold heading text
 * @param {string} desc    - Supporting description
 * @param {"info"|"success"|"warning"|"critical"} type
 */
export function showToast(title, desc, type = "info") {
  const icons = { info: "🔵", success: "🟢", warning: "🟠", critical: "🔴" };

  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.innerHTML = `
    <div class="toast-icon">${icons[type] || "🔵"}</div>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      <div class="toast-desc">${desc}</div>
    </div>
    <button class="toast-dismiss" onclick="this.closest('.toast').remove()">×</button>
  `;

  container.appendChild(el);

  // Auto-dismiss after 4.5s (matches CSS progress bar duration)
  setTimeout(() => {
    el.classList.add("toast-out");
    setTimeout(() => el.remove(), 300);
  }, 4500);
}

// Expose globally so messaging.js (loaded as a separate module) can call it
window.showToast = showToast;
