const video = document.getElementById('video');
const alarm = document.getElementById('alarm');
const scoreDisplay = document.getElementById('score');
const statusDisplay = document.getElementById('status');
const canvas = document.getElementById('overlay');

let fatigueScore = 0;
let isAlerting = false;

// 1. Load Models
Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri('https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights'),
    faceapi.nets.faceLandmark68Net.loadFromUri('https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights')
]).then(startVideo).catch(err => console.error("Model Load Error:", err));

function startVideo() {
    navigator.mediaDevices.getUserMedia({ video: {} })
        .then(stream => { video.srcObject = stream; })
        .catch(err => { statusDisplay.innerText = "Camera Error"; });
}

// 2. EAR Calculation (Vertical/Horizontal Ratio)
function calculateEAR(eye) {
    const v1 = Math.abs(eye[1].y - eye[5].y);
    const v2 = Math.abs(eye[2].y - eye[4].y);
    const h = Math.abs(eye[0].x - eye[3].x);
    return (v1 + v2) / (2 * h);
}

video.addEventListener('play', () => {
    const displaySize = { width: video.width, height: video.height };
    faceapi.matchDimensions(canvas, displaySize);

    setInterval(async () => {
        const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
            .withFaceLandmarks();

        if (detections.length > 0) {
            const landmarks = detections[0].landmarks;
            const leftEye = landmarks.getLeftEye();
            const rightEye = landmarks.getRightEye();
            const mouth = landmarks.getMouth();

            const leftEAR = calculateEAR(leftEye);
            const rightEAR = calculateEAR(rightEye);
            const avgEAR = (leftEAR + rightEAR) / 2;

            // Mouth Ratio (Vertical height vs Horizontal width)
            const mouthHeight = Math.abs(mouth[14].y - mouth[18].y);
            const mouthWidth = Math.abs(mouth[12].x - mouth[16].x);
            const mouthRatio = mouthHeight / mouthWidth;

            // --- BALANCED THRESHOLDS ---
            // avgEAR < 0.30: Very sensitive to eye closure/drooping
            // mouthRatio > 0.60: Average yawn (not too wide, not too small)
            if (avgEAR < 0.30 || mouthRatio > 0.60) {
                fatigueScore++;
            } else {
                if (fatigueScore > 0) fatigueScore -= 2;
                if (fatigueScore < 0) fatigueScore = 0;
            }

            updateFatigueUI();

        } else {
            statusDisplay.innerText = "No Face Detected";
        }
    }, 150);
});

function updateFatigueUI() {
    scoreDisplay.innerText = `Fatigue Score: ${fatigueScore}`;

    // Alarm triggers after ~1 second of continuous drowsiness
    if (fatigueScore >= 7 && !isAlerting) {
        startAlert();
    }
    else if (fatigueScore === 0 && isAlerting) {
        stopAlert();
    }
}

function startAlert() {
    isAlerting = true;
    statusDisplay.innerText = "⚠️ DROWSINESS DETECTED! ⚠️";
    document.body.classList.add('danger');

    alarm.loop = false;
    alarm.play().catch(e => console.log("Click the screen once to enable audio"));

    const msg = new SpeechSynthesisUtterance("Wake up! Stay alert!");
    window.speechSynthesis.speak(msg);
}

function stopAlert() {
    isAlerting = false;
    statusDisplay.innerText = "Status: Monitoring...";
    document.body.classList.remove('danger');
    alarm.pause();
    alarm.currentTime = 0;
    window.speechSynthesis.cancel();
}