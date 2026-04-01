/* =========================================================
   src/ui/alarmModule.js
   Encapsulates all audio alarm state and critical UI effects.
   Handles browser autoplay policy with explicit user-unlock.
   ========================================================= */

const alarm     = new Audio("/alarm.mp3");
alarm.loop      = true;
alarm.volume    = 1;

let alarmPlaying    = false;
let audioUnlocked   = false;
let criticalPending = false;  // true when a critical alert is active

const soundBanner    = document.getElementById("soundBanner");
const criticalFlash  = document.getElementById("criticalFlash");
const alarmIndicator = document.getElementById("alarmIndicator");

/* ── AUDIO UNLOCK ─────────────────────────────────────────
   Browsers block autoplay until a real user gesture occurs.
   We play a silent moment to satisfy the policy.
   ─────────────────────────────────────────────────────── */
export function unlockAudio() {
  if (audioUnlocked) return;

  alarm.volume = 0;
  alarm.play()
    .then(() => {
      alarm.pause();
      alarm.currentTime = 0;
      alarm.volume      = 1;
      audioUnlocked     = true;

      soundBanner?.classList.add("hidden");

      // If a critical alert already arrived before unlock, play now
      if (criticalPending && !alarmPlaying) {
        alarmPlaying = true;
        alarm.currentTime = 0;
        alarm.play().catch(e => console.warn("Alarm play failed:", e));
      }
    })
    .catch(e => console.warn("Audio unlock failed:", e));
}

/** Register all gesture events that unlock audio */
export function setupAudioUnlock() {
  document.addEventListener("click",      unlockAudio);
  document.addEventListener("keydown",    unlockAudio);
  document.addEventListener("touchstart", unlockAudio);
  soundBanner?.addEventListener("click",  unlockAudio);
}

/* ── CRITICAL UI — ENABLE ─────────────────────────────── */
export function enableCriticalUI() {
  criticalFlash?.classList.add("active");
  alarmIndicator?.classList.add("active");

  // Screen shake (restart by forcing reflow)
  document.body.classList.remove("shake-active");
  void document.body.offsetWidth;
  document.body.classList.add("shake-active");
  setTimeout(() => document.body.classList.remove("shake-active"), 600);

  criticalPending = true;

  if (audioUnlocked && !alarmPlaying) {
    alarmPlaying = true;
    alarm.currentTime = 0;
    alarm.play().catch(e => console.warn("Alarm play failed:", e));
  } else if (!audioUnlocked && soundBanner) {
    // Escalate the banner to draw attention
    soundBanner.style.background   = "linear-gradient(90deg, #7f1d1d, #450a0a)";
    soundBanner.style.borderColor  = "#ef4444";
    const icon = soundBanner.querySelector(".sb-icon");
    const msg  = soundBanner.querySelector("span:nth-child(2)");
    if (icon) icon.textContent = "🚨";
    if (msg)  msg.textContent  = "⚠ CRITICAL DISASTER ALERT — Click to enable alarm sound NOW";
  }
}

/* ── CRITICAL UI — DISABLE ────────────────────────────── */
export function disableCriticalUI() {
  criticalFlash?.classList.remove("active");
  alarmIndicator?.classList.remove("active");

  criticalPending = false;

  if (alarmPlaying) {
    alarm.pause();
    alarm.currentTime = 0;
    alarmPlaying = false;
  }
}

/* ── DISMISS ALARM (with session persistence) ─────────── */
/**
 * Called when the user explicitly dismisses the alarm.
 * @param {string} alertId - The active critical alert ID to persist
 */
export function dismissAlarm(alertId) {
  if (alarmPlaying) {
    alarm.pause();
    alarm.currentTime = 0;
    alarmPlaying = false;
  }
  // Persist so page refresh doesn't retrigger for the same alert
  if (alertId) sessionStorage.setItem("dismissedAlarm", alertId);
}

/** Returns the session-dismissed alarm ID (if any) */
export function getDismissedAlarmId() {
  return sessionStorage.getItem("dismissedAlarm");
}
