const alarm = new Audio("/assets/audio/alarm.mp3");
alarm.loop = true;
alarm.volume = 1;

let alarmPlaying = false;
let audioUnlocked = false;
let criticalPending = false;

const soundBanner = document.getElementById("soundBanner");
const criticalFlash = document.getElementById("criticalFlash");
const alarmIndicator = document.getElementById("alarmIndicator");

export function unlockAudio() {
  if (audioUnlocked) return;

  alarm.volume = 0;
  alarm.play()
    .then(() => {
      alarm.pause();
      alarm.currentTime = 0;
      alarm.volume = 1;
      audioUnlocked = true;
      soundBanner?.classList.add("hidden");

      if (criticalPending && !alarmPlaying) {
        alarmPlaying = true;
        alarm.currentTime = 0;
        alarm.play().catch((error) => console.warn("Alarm play failed:", error));
      }
    })
    .catch((error) => console.warn("Audio unlock failed:", error));
}

export function setupAudioUnlock() {
  document.addEventListener("click", unlockAudio);
  document.addEventListener("keydown", unlockAudio);
  document.addEventListener("touchstart", unlockAudio);
  soundBanner?.addEventListener("click", unlockAudio);
}

export function triggerPocketVibration() {
  if ("vibrate" in navigator) {
    try {
      // 6-second heavy multi-pulse vibration pattern
      navigator.vibrate([500, 200, 500, 200, 500, 200, 1000, 300, 1000, 300, 1000]);
    } catch (e) {
      console.warn("Vibration failed:", e);
    }
  }
}

export function stopPocketVibration() {
  if ("vibrate" in navigator) {
    try {
      navigator.vibrate(0);
    } catch (e) {}
  }
}

export function enableCriticalUI() {
  criticalPending = true;
  criticalFlash?.classList.add("active");
  alarmIndicator?.classList.add("active");

  document.body.classList.remove("shake-active");
  void document.body.offsetWidth;
  document.body.classList.add("shake-active");
  setTimeout(() => document.body.classList.remove("shake-active"), 600);

  // Trigger device vibration
  triggerPocketVibration();

  if (audioUnlocked && !alarmPlaying) {
    alarmPlaying = true;
    alarm.currentTime = 0;
    alarm.play().catch((error) => console.warn("Alarm play failed:", error));
  } else if (!audioUnlocked && soundBanner) {
    soundBanner.style.background = "linear-gradient(90deg, #7f1d1d, #450a0a)";
    soundBanner.style.borderColor = "#ef4444";
    const icon = soundBanner.querySelector(".sb-icon");
    const message = soundBanner.querySelector("span:nth-child(2)");
    if (icon) icon.textContent = "🚨";
    if (message) message.textContent = "CRITICAL DISASTER ALERT - Click to enable alarm sound now";
  }
}

export function disableCriticalUI() {
  criticalPending = false;
  criticalFlash?.classList.remove("active");
  alarmIndicator?.classList.remove("active");
  stopPocketVibration();

  if (alarmPlaying) {
    alarm.pause();
    alarm.currentTime = 0;
    alarmPlaying = false;
  }
}

export function dismissAlarm(alertId) {
  stopPocketVibration();
  if (alarmPlaying) {
    alarm.pause();
    alarm.currentTime = 0;
    alarmPlaying = false;
  }

  if (alertId) {
    sessionStorage.setItem("dismissedAlarm", alertId);
  }
}

export function getDismissedAlarmId() {
  return sessionStorage.getItem("dismissedAlarm");
}
