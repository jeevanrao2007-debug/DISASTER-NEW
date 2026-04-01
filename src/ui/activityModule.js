/* =========================================================
   src/ui/activityModule.js
   Encapsulates the live activity stream panel.
   Exposes window.addActivity globally for messaging.js compat.
   ========================================================= */

const activityList = document.getElementById("activityList");
let activityTimes = []; // { el, ts } pairs for live time-ago refresh

/**
 * Prepend a new entry to the activity stream.
 * @param {string} text      - HTML-safe label (bold tags allowed)
 * @param {string} dotClass  - "green" | "yellow" | "red" | ""
 * @param {number} timestamp - Unix ms (defaults to now)
 */
export function addActivity(text, dotClass = "", timestamp = Date.now()) {
  // Cap stream at 6 visible items
  while (activityList.children.length >= 6) activityList.lastChild.remove();

  const li = document.createElement("li");
  li.className = "activity-item";
  li.innerHTML = `
    <div class="ai-dot ${dotClass}"></div>
    <span>${text}</span>
    <span class="ai-time" data-ts="${timestamp}">now</span>
  `;
  activityList.insertBefore(li, activityList.firstChild);
  activityTimes.push({ el: li.querySelector(".ai-time"), ts: timestamp });
}

/** Human-readable relative time string */
function timeAgo(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

// Refresh all timestamps every 5 seconds
setInterval(() => {
  activityTimes.forEach(({ el, ts }) => { el.textContent = timeAgo(ts); });
}, 5000);

// Expose globally so messaging.js can call it
window.addActivity = addActivity;
