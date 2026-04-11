/* =========================================================
   src/ui/simulationModule.js
   Local-only disaster simulation overlays for admin demos.
   ========================================================= */

const SEVERITY_VISUALS = {
  low: { color: "#22c55e", maxRadius: 900, durationMs: 9500 },
  moderate: { color: "#facc15", maxRadius: 1300, durationMs: 8500 },
  high: { color: "#fb923c", maxRadius: 1800, durationMs: 7600 },
  critical: { color: "#ef4444", maxRadius: 2400, durationMs: 6800 }
};

function easeOutQuad(t) {
  return 1 - (1 - t) * (1 - t);
}

function normalizeSeverity(value) {
  const s = String(value || "moderate").toLowerCase();
  if (SEVERITY_VISUALS[s]) return s;
  return "moderate";
}

function titleCase(value) {
  const s = String(value || "");
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "";
}

function normalizeType(value) {
  const t = String(value || "flood").toLowerCase();
  if (t === "flood" || t === "earthquake" || t === "fire") return t;
  return "flood";
}

function styleForType(type) {
  if (type === "fire") {
    return { dashArray: "2 8", weightBoost: 0.4 };
  }
  if (type === "earthquake") {
    return { dashArray: "8 10", weightBoost: 0.2 };
  }
  return { dashArray: "", weightBoost: 0 };
}

export function createSimulationController(map, options = {}) {
  if (!map) {
    throw new Error("Simulation controller requires a Leaflet map instance");
  }

  const onCreate = typeof options.onCreate === "function" ? options.onCreate : null;
  const onStopAll = typeof options.onStopAll === "function" ? options.onStopAll : null;

  let enabled = false;
  const active = new Set();

  function syncCount() {
    if (typeof options.onCountChange === "function") {
      options.onCountChange(active.size);
    }
  }

  function createSimulation({ latlng, type = "flood", severity = "moderate" } = {}) {
    if (!latlng || !Number.isFinite(latlng.lat) || !Number.isFinite(latlng.lng)) {
      return null;
    }

    const normalizedType = normalizeType(type);
    const normalizedSeverity = normalizeSeverity(severity);
    const visual = SEVERITY_VISUALS[normalizedSeverity];
    const typeStyle = styleForType(normalizedType);
    const radiusStart = 60;

    const circle = L.circle([latlng.lat, latlng.lng], {
      radius: radiusStart,
      color: visual.color,
      weight: 2 + typeStyle.weightBoost,
      opacity: 0.95,
      fillColor: visual.color,
      fillOpacity: 0.22,
      dashArray: typeStyle.dashArray,
      interactive: false,
      bubblingMouseEvents: false
    }).addTo(map);

    const record = {
      circle,
      stopped: false,
      animationFrameId: null,
      stop() {
        if (record.stopped) return;
        record.stopped = true;
        if (record.animationFrameId != null) {
          cancelAnimationFrame(record.animationFrameId);
        }
        map.removeLayer(circle);
        active.delete(record);
        syncCount();
      }
    };

    active.add(record);
    syncCount();

    const startedAt = performance.now();

    function animate(now) {
      if (record.stopped) return;

      const elapsed = now - startedAt;
      const progress = Math.min(1, elapsed / visual.durationMs);
      const eased = easeOutQuad(progress);
      const radius = radiusStart + (visual.maxRadius - radiusStart) * eased;

      circle.setRadius(radius);
      circle.setStyle({
        opacity: Math.max(0.12, 0.95 - progress * 0.85),
        fillOpacity: Math.max(0.04, 0.22 - progress * 0.18)
      });

      if (progress >= 1) {
        record.stop();
        return;
      }

      record.animationFrameId = requestAnimationFrame(animate);
    }

    record.animationFrameId = requestAnimationFrame(animate);

    if (onCreate) {
      onCreate({
        type: titleCase(normalizedType),
        severity: titleCase(normalizedSeverity),
        latlng
      });
    }

    return record;
  }

  function stopAllSimulations() {
    [...active].forEach((entry) => entry.stop());
    if (onStopAll) onStopAll();
  }

  return {
    setEnabled(next) {
      enabled = Boolean(next);
    },
    isEnabled() {
      return enabled;
    },
    createSimulation,
    stopAllSimulations,
    activeCount() {
      return active.size;
    }
  };
}
