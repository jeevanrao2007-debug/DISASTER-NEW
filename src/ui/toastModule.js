const container = document.getElementById("toastContainer");

export function showToast(title, desc, type = "info") {
  const icons = {
    info: "🔵",
    success: "🟢",
    warning: "🟠",
    critical: "🔴"
  };

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

  setTimeout(() => {
    el.classList.add("toast-out");
    setTimeout(() => el.remove(), 300);
  }, type === "critical" ? 7000 : 4500);
}

window.showToast = showToast;
