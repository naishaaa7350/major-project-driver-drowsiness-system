"use strict";

const video = document.getElementById("inputVideo");
const canvas = document.getElementById("overlayCanvas");
const ctx = canvas.getContext("2d");

const elements = {
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  calibrateBtn: document.getElementById("calibrateBtn"),
  muteBtn: document.getElementById("muteBtn"),
  resetBtn: document.getElementById("resetBtn"),
  exportBtn: document.getElementById("exportBtn"),
  clearEventsBtn: document.getElementById("clearEventsBtn"),
  cameraSelect: document.getElementById("cameraSelect"),
  cameraOverlay: document.getElementById("cameraOverlay"),
  cameraStatus: document.getElementById("cameraStatus"),
  faceStatus: document.getElementById("faceStatus"),
  fpsValue: document.getElementById("fpsValue"),
  sessionTime: document.getElementById("sessionTime"),
  dashboardPanel: document.getElementById("dashboardPanel"),
  stateChipText: document.getElementById("stateChipText"),
  stateTitle: document.getElementById("stateTitle"),
  stateCopy: document.getElementById("stateCopy"),
  scoreRing: document.getElementById("scoreRing"),
  fatigueScore: document.getElementById("fatigueScore"),
  eyeRatio: document.getElementById("eyeRatio"),
  mouthRatio: document.getElementById("mouthRatio"),
  blinkCount: document.getElementById("blinkCount"),
  yawnCount: document.getElementById("yawnCount"),
  alertCount: document.getElementById("alertCount"),
  alarmStatus: document.getElementById("alarmStatus"),
  eyeThreshold: document.getElementById("eyeThreshold"),
  mouthThreshold: document.getElementById("mouthThreshold"),
  recoveryHold: document.getElementById("recoveryHold"),
  eyeThresholdValue: document.getElementById("eyeThresholdValue"),
  mouthThresholdValue: document.getElementById("mouthThresholdValue"),
  recoveryHoldValue: document.getElementById("recoveryHoldValue"),
  landmarkToggle: document.getElementById("landmarkToggle"),
  voiceToggle: document.getElementById("voiceToggle"),
  eventList: document.getElementById("eventList"),
  locationBtn: document.getElementById("locationBtn"),
locationStatus: document.getElementById("locationStatus"),

};

const LEFT_EYE = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE = [362, 385, 387, 263, 373, 380];
const MOUTH = {
  topInner: 13,
  bottomInner: 14,
  leftCorner: 78,
  rightCorner: 308,
};

const settings = {
  eyeThreshold: Number(localStorage.getItem("awakeguard-eye-threshold")) || 0.21,
  mouthThreshold: Number(localStorage.getItem("awakeguard-mouth-threshold")) || 0.34,
  recoveryHoldMs: Number(localStorage.getItem("awakeguard-recovery-ms")) || 2500,
  closedEyeAlarmMs: 1200,
  yawnHoldMs: 950,
  blinkMinMs: 60,
  blinkMaxMs: 480,
};

const session = {
  running: false,
  facePresent: false,
  sessionStartedAt: null,
  lastFrameAt: 0,
  fpsSamples: [],
  frameRequest: null,
  stream: null,
  faceMesh: null,
  eyeRatio: 0,
  mouthRatio: 0,
  blinkCount: 0,
  yawnCount: 0,
  alertCount: 0,
  blinkStartAt: null,
  eyeClosedSince: null,
  mouthOpenSince: null,
  yawnRegisteredForOpenMouth: false,
  alarmActive: false,
  alarmReason: "",
  clearSince: null,
  muted: false,
  lastVoiceAt: 0,
  fatigueScore: 5,
  calibrationSamples: [],
  calibrating: false,
  events: [],
  currentLocation: null,
    locationWatchId: null,

};

let audioContext = null;
let alarmOscillator = null;
let alarmGain = null;
let buzzerTimer = null;
let dashboardTimer = null;

function init() {
  applyStoredSettings();
  bindEvents();
  updateRangeLabels();
  refreshDevices();
  renderDashboard("Ready", "Initialize the camera to begin live drowsiness detection.", "Ready");

  if (!window.FaceMesh) {
    addEvent("MediaPipe FaceMesh could not load. Check your internet connection and refresh.");
    elements.startBtn.disabled = true;
    elements.cameraStatus.textContent = "Library missing";
  }
}

function bindEvents() {
  elements.startBtn.addEventListener("click", startCamera);
  elements.stopBtn.addEventListener("click", stopCamera);
  elements.calibrateBtn.addEventListener("click", calibrateAlertFace);
  elements.muteBtn.addEventListener("click", toggleMute);
  elements.resetBtn.addEventListener("click", resetSession);
  elements.exportBtn.addEventListener("click", exportReport);
  elements.clearEventsBtn.addEventListener("click", clearEvents);
  elements.cameraSelect.addEventListener("change", restartCameraIfRunning);
  elements.locationBtn.addEventListener("click", toggleLocationTracking);


  elements.eyeThreshold.addEventListener("input", () => {
    settings.eyeThreshold = Number(elements.eyeThreshold.value);
    localStorage.setItem("awakeguard-eye-threshold", String(settings.eyeThreshold));
    updateRangeLabels();
  });

  elements.mouthThreshold.addEventListener("input", () => {
    settings.mouthThreshold = Number(elements.mouthThreshold.value);
    localStorage.setItem("awakeguard-mouth-threshold", String(settings.mouthThreshold));
    updateRangeLabels();
  });

  elements.recoveryHold.addEventListener("input", () => {
    settings.recoveryHoldMs = Number(elements.recoveryHold.value) * 1000;
    localStorage.setItem("awakeguard-recovery-ms", String(settings.recoveryHoldMs));
    updateRangeLabels();
  });
}

function applyStoredSettings() {
  elements.eyeThreshold.value = settings.eyeThreshold.toFixed(2);
  elements.mouthThreshold.value = settings.mouthThreshold.toFixed(2);
  elements.recoveryHold.value = (settings.recoveryHoldMs / 1000).toFixed(1);
}
function toggleLocationTracking() {
  if (session.locationWatchId !== null) {
    stopLocationTracking();
    return;
  }

  startLocationTracking();
}

function startLocationTracking() {
  if (!navigator.geolocation) {
    elements.locationStatus.textContent = "Not supported";
    addEvent("Location tracking is not supported in this browser.");
    return;
  }

  elements.locationStatus.textContent = "Locating...";
  elements.locationBtn.textContent = "Stop Location";

  session.locationWatchId = navigator.geolocation.watchPosition(
    handleLocationSuccess,
    handleLocationError,
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 5000,
    }
  );

  addEvent("Location tracking started.");
}

function stopLocationTracking() {
  if (session.locationWatchId !== null) {
    navigator.geolocation.clearWatch(session.locationWatchId);
    session.locationWatchId = null;
  }

  elements.locationBtn.textContent = "Track Location";
  elements.locationStatus.textContent = session.currentLocation
    ? "Saved"
    : "Not tracked";

  addEvent("Location tracking stopped.");
}

async function handleLocationSuccess(position) {
  const { latitude, longitude, accuracy } = position.coords;

  session.currentLocation = {
    latitude,
    longitude,
    accuracy,
    timestamp: new Date(position.timestamp).toLocaleString(),
    placeName: "Finding place name...",
    mapUrl: `https://www.google.com/maps?q=${latitude},${longitude}`,
  };

  const currentLocation = session.currentLocation;
  elements.locationStatus.textContent = currentLocation.placeName;

  try {
    currentLocation.placeName = await getPlaceName(latitude, longitude);
  } catch (error) {
    currentLocation.placeName = "Place name unavailable";
  }

  if (session.currentLocation !== currentLocation) return;

  elements.locationStatus.textContent = currentLocation.placeName;
  addEvent(`Location updated: ${currentLocation.placeName}. Accuracy: ${Math.round(accuracy)} meters.`);
}

function handleLocationError(error) {
  let message = "Location access failed.";

  if (error.code === error.PERMISSION_DENIED) {
    message = "Location permission denied.";
  } else if (error.code === error.POSITION_UNAVAILABLE) {
    message = "Location information unavailable.";
  } else if (error.code === error.TIMEOUT) {
    message = "Location request timed out.";
  }

  elements.locationStatus.textContent = "Unavailable";
  elements.locationBtn.textContent = "Track Location";

  if (session.locationWatchId !== null) {
    navigator.geolocation.clearWatch(session.locationWatchId);
    session.locationWatchId = null;
  }

  addEvent(message);
}

async function getPlaceName(latitude, longitude) {
  const url = new URL("https://api.bigdatacloud.net/data/reverse-geocode-client");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("localityLanguage", "en");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Reverse geocoding failed.");
  }

  const data = await response.json();
  const parts = [
    data.locality || data.city,
    data.principalSubdivision,
    data.countryName,
  ].filter(Boolean);
  const uniqueParts = parts.filter((part, index) => parts.indexOf(part) === index);

  return uniqueParts.join(", ") || "Place name unavailable";
}


function updateRangeLabels() {
  elements.eyeThresholdValue.textContent = `${settings.eyeThreshold.toFixed(2)} EAR`;
  elements.mouthThresholdValue.textContent = `${settings.mouthThreshold.toFixed(2)} MAR`;
  elements.recoveryHoldValue.textContent = `${(settings.recoveryHoldMs / 1000).toFixed(1)} seconds clear`;
}

async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    addEvent("This browser does not support camera device listing.");
    return;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((device) => device.kind === "videoinput");
    const selected = elements.cameraSelect.value;

    elements.cameraSelect.innerHTML = '<option value="">Default camera</option>';
    cameras.forEach((camera, index) => {
      const option = document.createElement("option");
      option.value = camera.deviceId;
      option.textContent = camera.label || `Camera ${index + 1}`;
      elements.cameraSelect.appendChild(option);
    });

    if (selected && cameras.some((camera) => camera.deviceId === selected)) {
      elements.cameraSelect.value = selected;
    }
  } catch (error) {
    addEvent(`Camera list unavailable: ${error.message}`);
  }
}

async function startCamera() {
  if (session.running) return;

  try {
    await unlockAudio();
    await createFaceMesh();

    const selectedCamera = elements.cameraSelect.value;
    const constraints = {
      audio: false,
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "user",
      },
    };

    if (selectedCamera) {
      constraints.video.deviceId = { exact: selectedCamera };
      delete constraints.video.facingMode;
    }

    session.stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = session.stream;
    await video.play();

    fitCanvasToVideo();
    session.running = true;
    session.sessionStartedAt = Date.now();
    session.lastFrameAt = performance.now();
    video.classList.add("is-live");
    elements.cameraOverlay.classList.add("is-hidden");
    elements.startBtn.disabled = true;
    elements.stopBtn.disabled = false;
    elements.calibrateBtn.disabled = false;
    elements.cameraStatus.textContent = "Online";
    addEvent("Camera initialized. Face detection is running.");
    refreshDevices();
    detectionLoop();

    clearInterval(dashboardTimer);
    dashboardTimer = setInterval(updateSessionClock, 500);
  } catch (error) {
    elements.cameraStatus.textContent = "Blocked";
    addEvent(`Camera initialization failed: ${error.message}`);
    renderDashboard("Camera blocked", "Allow camera permission and use localhost or HTTPS if the browser blocks access.", "Check");
    stopAlarm("camera error");
  }
}

async function createFaceMesh() {
  if (session.faceMesh) return;

  session.faceMesh = new FaceMesh({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
  });

  session.faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.58,
    minTrackingConfidence: 0.55,
  });

  session.faceMesh.onResults(handleResults);
}

async function detectionLoop() {
  if (!session.running || !session.faceMesh) return;

  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    fitCanvasToVideo();
    await session.faceMesh.send({ image: video });
  }

  session.frameRequest = requestAnimationFrame(detectionLoop);
}

function fitCanvasToVideo() {
  if (!video.videoWidth || !video.videoHeight) return;

  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
}

function handleResults(results) {
  const now = performance.now();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  recordFps(now);

  const landmarks = results.multiFaceLandmarks?.[0];
  if (!landmarks) {
    session.facePresent = false;
    session.clearSince = null;
    elements.faceStatus.textContent = "No face";
    renderDashboard("Face not detected", "Move into the frame so the detector can track eyes and mouth.", "Scanning");
    return;
  }

  session.facePresent = true;
  elements.faceStatus.textContent = "Locked";

  if (elements.landmarkToggle.checked) {
    drawFaceGuides(landmarks);
  }

  const eyeRatio = (eyeAspectRatio(landmarks, LEFT_EYE) + eyeAspectRatio(landmarks, RIGHT_EYE)) / 2;
  const mouthRatio = mouthAspectRatio(landmarks);
  session.eyeRatio = eyeRatio;
  session.mouthRatio = mouthRatio;

  if (session.calibrating) {
    session.calibrationSamples.push({ eyeRatio, mouthRatio });
  }

  analyzeSignals(now, eyeRatio, mouthRatio);
}

function drawFaceGuides(landmarks) {
  if (!window.drawConnectors) return;

  ctx.save();
  ctx.lineWidth = 2;
  drawConnectors(ctx, landmarks, FACEMESH_LEFT_EYE, { color: "#20a66a", lineWidth: 2 });
  drawConnectors(ctx, landmarks, FACEMESH_RIGHT_EYE, { color: "#20a66a", lineWidth: 2 });
  drawConnectors(ctx, landmarks, FACEMESH_LIPS, { color: "#f2b84b", lineWidth: 2 });
  drawConnectors(ctx, landmarks, FACEMESH_FACE_OVAL, { color: "rgba(255,255,255,0.75)", lineWidth: 1 });
  ctx.restore();
}

function analyzeSignals(now, eyeRatio, mouthRatio) {
  const eyesClosed = eyeRatio < settings.eyeThreshold;
  const mouthOpen = mouthRatio > settings.mouthThreshold;

  handleBlinkAndEyeClosure(now, eyesClosed);
  handleYawn(now, mouthOpen);
  updateFatigueScore(eyesClosed, mouthOpen);

  const alertPosture = !eyesClosed && !mouthOpen && eyeRatio > settings.eyeThreshold * 1.08 && mouthRatio < settings.mouthThreshold * 0.92;

  if (session.alarmActive) {
    if (alertPosture) {
      session.clearSince = session.clearSince || now;
      if (now - session.clearSince >= settings.recoveryHoldMs) {
        stopAlarm("alert posture recovered");
        addEvent("Alarm stopped after alert posture was detected.");
      }
    } else {
      session.clearSince = null;
      keepWarningAlive();
    }
  }

  if (!session.alarmActive) {
    if (eyesClosed) {
      renderDashboard("Eyes closing", "Blink signal is above the safe duration. Stay alert.", "Warning");
    } else if (mouthOpen) {
      renderDashboard("Yawn detected", "Mouth opening signal is above the yawning threshold.", "Warning");
    } else {
      renderDashboard("Alert", "Eye and mouth signals are within the alert range.", "Ready");
    }
  }
}

function handleBlinkAndEyeClosure(now, eyesClosed) {
  if (eyesClosed && session.blinkStartAt === null) {
    session.blinkStartAt = now;
    session.eyeClosedSince = now;
    return;
  }

  if (eyesClosed && session.eyeClosedSince && now - session.eyeClosedSince > settings.closedEyeAlarmMs) {
    triggerAlarm("Eyes closed too long");
    renderDashboard("Drowsiness detected", "Eyes stayed closed longer than the alert threshold.", "Alarm");
    return;
  }

  if (!eyesClosed && session.blinkStartAt !== null) {
    const blinkDuration = now - session.blinkStartAt;
    if (blinkDuration >= settings.blinkMinMs && blinkDuration <= settings.blinkMaxMs) {
      session.blinkCount += 1;
    }

    session.blinkStartAt = null;
    session.eyeClosedSince = null;
  }
}

function handleYawn(now, mouthOpen) {
  if (mouthOpen && session.mouthOpenSince === null) {
    session.mouthOpenSince = now;
    session.yawnRegisteredForOpenMouth = false;
    return;
  }

  if (mouthOpen && session.mouthOpenSince && !session.yawnRegisteredForOpenMouth && now - session.mouthOpenSince > settings.yawnHoldMs) {
    session.yawnCount += 1;
    session.yawnRegisteredForOpenMouth = true;
    triggerAlarm("Yawning detected");
    renderDashboard("Yawning detected", "A sustained mouth-opening signal indicates drowsiness.", "Alarm");
    return;
  }

  if (!mouthOpen) {
    session.mouthOpenSince = null;
    session.yawnRegisteredForOpenMouth = false;
  }
}

function updateFatigueScore(eyesClosed, mouthOpen) {
  let score = 5;

  if (eyesClosed) score += 28;
  if (mouthOpen) score += 24;
  if (session.alarmActive) score += 35;
  score += Math.min(session.yawnCount * 4, 16);
  score += Math.min(Math.floor(session.blinkCount / 10) * 3, 12);

  session.fatigueScore = Math.max(0, Math.min(100, Math.round(score)));
}

function triggerAlarm(reason) {
  if (!session.alarmActive) {
    session.alertCount += 1;
    session.alarmReason = reason;
    session.alarmActive = true;
    session.clearSince = null;
    addEvent(`${reason}. Buzzer and voice warning started.`);
  }

  startBuzzer();
  speakWarning();
}

async function unlockAudio() {
  if (audioContext) {
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
    return;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    addEvent("Web Audio is not available in this browser. Voice warning can still work.");
    return;
  }

  audioContext = new AudioContextClass();
  alarmGain = audioContext.createGain();
  alarmGain.gain.value = 0;
  alarmGain.connect(audioContext.destination);

  alarmOscillator = audioContext.createOscillator();
  alarmOscillator.type = "square";
  alarmOscillator.frequency.value = 880;
  alarmOscillator.connect(alarmGain);
  alarmOscillator.start();
}

function startBuzzer() {
  if (session.muted || !audioContext || !alarmGain) return;

  if (audioContext.state === "suspended") {
    audioContext.resume();
  }

  if (buzzerTimer) return;

  pulseBuzzer();
  buzzerTimer = setInterval(pulseBuzzer, 720);
}

function pulseBuzzer() {
  if (!audioContext || !alarmGain || session.muted) return;

  const now = audioContext.currentTime;
  alarmGain.gain.cancelScheduledValues(now);
  alarmGain.gain.setValueAtTime(0.0001, now);
  alarmGain.gain.exponentialRampToValueAtTime(0.18, now + 0.03);
  alarmGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
}

function speakWarning() {
  if (session.muted || !elements.voiceToggle.checked || !("speechSynthesis" in window)) return;

  const now = Date.now();
  if (now - session.lastVoiceAt < 5200) return;

  session.lastVoiceAt = now;
  const utterance = new SpeechSynthesisUtterance("Wake up, you are feeling drowsy");
  utterance.rate = 0.94;
  utterance.pitch = 1.05;
  utterance.volume = 1;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function keepWarningAlive() {
  startBuzzer();
  speakWarning();
}

function stopAlarm() {
  session.alarmActive = false;
  session.alarmReason = "";
  session.clearSince = null;

  if (buzzerTimer) {
    clearInterval(buzzerTimer);
    buzzerTimer = null;
  }

  if (audioContext && alarmGain) {
    const now = audioContext.currentTime;
    alarmGain.gain.cancelScheduledValues(now);
    alarmGain.gain.setValueAtTime(Math.max(alarmGain.gain.value, 0.0001), now);
    alarmGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
  }

  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

async function calibrateAlertFace() {
  if (!session.running) return;

  session.calibrationSamples = [];
  session.calibrating = true;
  elements.calibrateBtn.disabled = true;
  elements.calibrateBtn.textContent = "Calibrating...";
  addEvent("Calibration started. Keep eyes open and mouth relaxed for three seconds.");

  await wait(3000);

  session.calibrating = false;
  elements.calibrateBtn.disabled = false;
  elements.calibrateBtn.textContent = "Calibrate Alert Face";

  if (session.calibrationSamples.length < 10) {
    addEvent("Calibration skipped. Face was not stable enough.");
    return;
  }

  const avgEye = average(session.calibrationSamples.map((sample) => sample.eyeRatio));
  const avgMouth = average(session.calibrationSamples.map((sample) => sample.mouthRatio));
  settings.eyeThreshold = clamp(avgEye * 0.72, 0.14, 0.28);
  settings.mouthThreshold = clamp(avgMouth + 0.16, 0.24, 0.52);

  elements.eyeThreshold.value = settings.eyeThreshold.toFixed(2);
  elements.mouthThreshold.value = settings.mouthThreshold.toFixed(2);
  localStorage.setItem("awakeguard-eye-threshold", String(settings.eyeThreshold));
  localStorage.setItem("awakeguard-mouth-threshold", String(settings.mouthThreshold));
  updateRangeLabels();
  addEvent(`Calibration complete. EAR ${settings.eyeThreshold.toFixed(2)}, MAR ${settings.mouthThreshold.toFixed(2)}.`);
}

function toggleMute() {
  session.muted = !session.muted;
  elements.muteBtn.textContent = session.muted ? "Unmute Alarm" : "Mute Alarm";
  elements.muteBtn.setAttribute("aria-pressed", String(session.muted));

  if (session.muted) {
    stopAlarm();
    addEvent("Alarm muted.");
  } else {
    addEvent("Alarm unmuted.");
  }
}

async function restartCameraIfRunning() {
  if (!session.running) return;
  await stopCamera();
  await startCamera();
}

async function stopCamera() {
  session.running = false;

  if (session.frameRequest) {
    cancelAnimationFrame(session.frameRequest);
    session.frameRequest = null;
  }

  if (session.stream) {
    session.stream.getTracks().forEach((track) => track.stop());
    session.stream = null;
  }

  stopAlarm();
  clearInterval(dashboardTimer);
  video.pause();
  video.srcObject = null;
  video.classList.remove("is-live");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  elements.cameraOverlay.classList.remove("is-hidden");
  elements.startBtn.disabled = false;
  elements.stopBtn.disabled = true;
  elements.calibrateBtn.disabled = true;
  elements.cameraStatus.textContent = "Offline";
  elements.faceStatus.textContent = "Waiting";
  addEvent("Camera stopped.");
}

function resetSession() {
  session.sessionStartedAt = session.running ? Date.now() : null;
  session.lastFrameAt = performance.now();
  session.fpsSamples = [];
  session.eyeRatio = 0;
  session.mouthRatio = 0;
  session.blinkCount = 0;
  session.yawnCount = 0;
  session.alertCount = 0;
  session.blinkStartAt = null;
  session.eyeClosedSince = null;
  session.mouthOpenSince = null;
  session.yawnRegisteredForOpenMouth = false;
  session.fatigueScore = 5;
  stopAlarm();
  addEvent("Session metrics reset.");
  renderDashboard("Alert", "Session metrics are clear.", "Ready");
}

function exportReport() {
  const jsPDF = window.jspdf?.jsPDF;
  if (!jsPDF) {
    addEvent("PDF library could not load. Check your internet connection and refresh.");
    return;
  }

  const doc = new jsPDF();
  const margin = 14;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = pageWidth - margin * 2;
  let y = 18;

  const addPageIfNeeded = (heightNeeded = 8) => {
    if (y + heightNeeded <= pageHeight - margin) return;
    doc.addPage();
    y = 18;
  };

  const sectionTitle = (title) => {
    addPageIfNeeded(12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(title, margin, y);
    y += 8;
  };

  const row = (label, value) => {
    const text = String(value);
    const lines = doc.splitTextToSize(text, maxWidth - 48);
    addPageIfNeeded(Math.max(8, lines.length * 6));
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(`${label}:`, margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(lines, margin + 48, y);
    y += Math.max(8, lines.length * 6);
  };

  const paragraph = (text) => {
    const lines = doc.splitTextToSize(String(text), maxWidth);
    addPageIfNeeded(lines.length * 6);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(lines, margin, y);
    y += lines.length * 6 + 2;
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Web Based Ftigue Monitoring Report", margin, y);
  y += 10;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Generated At: ${new Date().toLocaleString()}`, margin, y);
  y += 10;

  sectionTitle("Session Summary");
  row("Session Duration", elements.sessionTime.textContent);
  row("Fatigue Score", session.fatigueScore);
  row("Blinks", session.blinkCount);
  row("Yawns", session.yawnCount);
  row("Alerts", session.alertCount);
  row("Latest Eye Ratio", session.eyeRatio.toFixed(3));
  row("Latest Mouth Ratio", session.mouthRatio.toFixed(3));
  row("Alarm", session.alarmActive ? "Active" : "Silent");

  sectionTitle("Sensitivity Settings");
  row("Eye Closure Threshold", `${settings.eyeThreshold.toFixed(2)} EAR`);
  row("Yawn Threshold", `${settings.mouthThreshold.toFixed(2)} MAR`);
  row("Recovery Hold", `${(settings.recoveryHoldMs / 1000).toFixed(1)} seconds`);

  sectionTitle("Current Location");
  if (session.currentLocation) {
    row("Place", session.currentLocation.placeName || "Place name unavailable");
    row("Accuracy", `${Math.round(session.currentLocation.accuracy)} meters`);
    row("Captured At", session.currentLocation.timestamp);
    row("Map Link", session.currentLocation.mapUrl);
  } else {
    paragraph("Location was not captured during this session.");
  }

  sectionTitle("Event Timeline");
  if (session.events.length) {
    session.events.slice(0, 20).forEach((event) => {
      paragraph(`${event.time} - ${event.message}`);
    });
  } else {
    paragraph("No events recorded.");
  }

  doc.save(`Fatigue-Monitoring report-${new Date().toISOString().slice(0, 10)}.pdf`);
  addEvent("Report exported as PDF.");
}

function clearEvents() {
  session.events = [];
  elements.eventList.innerHTML = "";
  addEvent("Timeline cleared.");
}

function renderDashboard(title, copy, mode) {
  elements.stateTitle.textContent = title;
  elements.stateCopy.textContent = copy;
  elements.stateChipText.textContent = mode;
  elements.eyeRatio.textContent = session.eyeRatio.toFixed(2);
  elements.mouthRatio.textContent = session.mouthRatio.toFixed(2);
  elements.blinkCount.textContent = String(session.blinkCount);
  elements.yawnCount.textContent = String(session.yawnCount);
  elements.alertCount.textContent = String(session.alertCount);
  elements.alarmStatus.textContent = session.alarmActive ? "Active" : "Silent";
  elements.fatigueScore.textContent = String(session.fatigueScore);
  elements.scoreRing.style.setProperty("--score-angle", `${Math.max(18, session.fatigueScore * 3.6)}deg`);

  elements.dashboardPanel.classList.remove("ready-mode", "warning-mode", "alarm-mode");
  if (mode === "Alarm") {
    elements.dashboardPanel.classList.add("alarm-mode");
  } else if (mode === "Warning" || mode === "Scanning" || mode === "Check") {
    elements.dashboardPanel.classList.add("warning-mode");
  } else {
    elements.dashboardPanel.classList.add("ready-mode");
  }
}

function updateSessionClock() {
  const elapsed = session.sessionStartedAt ? Date.now() - session.sessionStartedAt : 0;
  elements.sessionTime.textContent = formatDuration(elapsed);
}

function recordFps(now) {
  if (session.lastFrameAt) {
    const fps = 1000 / Math.max(now - session.lastFrameAt, 1);
    session.fpsSamples.push(fps);
    if (session.fpsSamples.length > 20) {
      session.fpsSamples.shift();
    }

    const averageFps = average(session.fpsSamples);
    elements.fpsValue.textContent = `${Math.round(averageFps)} fps`;
  }

  session.lastFrameAt = now;
}

function addEvent(message) {
  const event = {
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    message,
  };

  session.events.unshift(event);
  session.events = session.events.slice(0, 30);
  renderEvents();
}

function renderEvents() {
  elements.eventList.innerHTML = "";

  if (!session.events.length) {
    const emptyItem = document.createElement("li");
    emptyItem.innerHTML = "<time>Now</time><span>No events yet.</span>";
    elements.eventList.appendChild(emptyItem);
    return;
  }

  session.events.slice(0, 12).forEach((event) => {
    const item = document.createElement("li");
    const time = document.createElement("time");
    const message = document.createElement("span");
    time.textContent = event.time;
    message.textContent = event.message;
    item.append(time, message);
    elements.eventList.appendChild(item);
  });
}

function eyeAspectRatio(landmarks, indices) {
  const [p1, p2, p3, p4, p5, p6] = indices.map((index) => landmarks[index]);
  const verticalA = distance(p2, p6);
  const verticalB = distance(p3, p5);
  const horizontal = distance(p1, p4);
  return (verticalA + verticalB) / (2 * horizontal);
}

function mouthAspectRatio(landmarks) {
  const vertical = distance(landmarks[MOUTH.topInner], landmarks[MOUTH.bottomInner]);
  const horizontal = distance(landmarks[MOUTH.leftCorner], landmarks[MOUTH.rightCorner]);
  return vertical / horizontal;
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

window.addEventListener("beforeunload", () => {
  if (session.running) {
    session.stream?.getTracks().forEach((track) => track.stop());
  }
});

init();
