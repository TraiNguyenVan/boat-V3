// ==========================================
// 1. WebSocket
// ==========================================
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${wsProtocol}//${window.location.host}`;
const ws = new WebSocket(wsUrl);

const wsDot = document.getElementById('ws-dot');
const gamepadDot = document.getElementById('gamepad-dot');
const pingValue = document.getElementById('ping-value');
const gpsValue = document.getElementById('gps-value');
const distanceValue = document.getElementById('distance-value');
const rcThrottleValue = document.getElementById('rc-throttle');
const rcSteeringValue = document.getElementById('rc-steering');
const steeringTrimValue = document.getElementById('steering-trim');
const trimMinusButton = document.getElementById('trim-minus');
const trimPlusButton = document.getElementById('trim-plus');
const trimResetButton = document.getElementById('trim-reset');

const TRIM_STORAGE_KEY = 'boat-steering-trim-us';
const STEERING_TRIM_STEP_US = 5;
const STEERING_TRIM_MIN_US = -200;
const STEERING_TRIM_MAX_US = 200;
let steeringTrimUs = Number(localStorage.getItem(TRIM_STORAGE_KEY)) || 0;

ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'register', role: 'web' }));
    sendSteeringTrim();
    wsDot.className = 'indicator active';
};

ws.onclose = () => {
    wsDot.className = 'indicator';
};

// ==========================================
// 2. Map, home point, GPS marker
// ==========================================
const map = L.map('map', { zoomControl: false }).setView([16.82, 107.19], 13);

L.tileLayer('http://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    maxZoom: 20,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
    attribution: '© Google'
}).addTo(map);

const boatIcon = L.divIcon({
    className: 'boat-blue-dot',
    iconSize: [16, 16],
    iconAnchor: [8, 8]
});

let boatMarker = null;
let homeMarker = null;
let homeLatLng = null;
let currentLatLng = null;

document.getElementById('btn-set-home').addEventListener('click', () => {
    if (!currentLatLng) {
        alert('Chua co toa do GPS hien tai!');
        return;
    }

    homeLatLng = currentLatLng;

    if (!homeMarker) {
        homeMarker = L.circleMarker(homeLatLng, {
            color: '#f59e0b',
            fillColor: '#f59e0b',
            fillOpacity: 0.9,
            radius: 5
        }).addTo(map);
    } else {
        homeMarker.setLatLng(homeLatLng);
    }
});

setInterval(() => {
    if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 512) {
        ws.send(`P${Date.now()}`);
    }
}, 500);

ws.onmessage = (event) => {
    try {
        const data = JSON.parse(event.data);

        if (data.type === 'pong' || data.type === 'q') {
            const latency = Date.now() - data.t;
            pingValue.innerHTML = `${latency} <small>ms</small>`;
        }

        if (data.type === 'gps' && data.lat && data.lng) {
            currentLatLng = L.latLng(data.lat, data.lng);
            gpsValue.innerText = `${data.lat.toFixed(5)}, ${data.lng.toFixed(5)}`;

            if (homeLatLng) {
                const distance = currentLatLng.distanceTo(homeLatLng);
                distanceValue.innerHTML = `${distance.toFixed(0)} <small>m</small>`;
            }

            if (!boatMarker) {
                boatMarker = L.marker(currentLatLng, { icon: boatIcon }).addTo(map);
                map.setView(currentLatLng, 16);
            } else {
                boatMarker.setLatLng(currentLatLng);
            }
        }
    } catch (err) {
        console.error('WebSocket data error:', err);
    }
};

// ==========================================
// 3. PS4 gamepad control
// ==========================================
const CONTROL_KEEPALIVE_MS = 75;
const CONTROL_CHANGE_THRESHOLD = 1;
const MAX_WS_BUFFERED_BYTES = 128;

let gamepadIdx = null;
let controlFrameId = null;
let lastSentThrottle = null;
let lastSentSteering = null;
let lastControlSentAt = 0;
let lastDisplayedThrottle = null;
let lastDisplayedSteering = null;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function formatTrim(value) {
    return `${value >= 0 ? '+' : ''}${value} us`;
}

function renderSteeringTrim() {
    steeringTrimValue.innerText = formatTrim(steeringTrimUs);
    trimMinusButton.disabled = steeringTrimUs <= STEERING_TRIM_MIN_US;
    trimPlusButton.disabled = steeringTrimUs >= STEERING_TRIM_MAX_US;
}

function sendSteeringTrim() {
    if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount <= MAX_WS_BUFFERED_BYTES) {
        ws.send(`T${steeringTrimUs}`);
    }
}

function setSteeringTrim(value) {
    steeringTrimUs = clamp(Math.round(value), STEERING_TRIM_MIN_US, STEERING_TRIM_MAX_US);
    localStorage.setItem(TRIM_STORAGE_KEY, String(steeringTrimUs));
    renderSteeringTrim();
    sendSteeringTrim();
}

trimMinusButton.addEventListener('click', () => {
    setSteeringTrim(steeringTrimUs - STEERING_TRIM_STEP_US);
});

trimPlusButton.addEventListener('click', () => {
    setSteeringTrim(steeringTrimUs + STEERING_TRIM_STEP_US);
});

trimResetButton.addEventListener('click', () => {
    setSteeringTrim(0);
});

renderSteeringTrim();

window.addEventListener('gamepadconnected', (e) => {
    gamepadIdx = e.gamepad.index;
    gamepadDot.className = 'indicator active';
    lastSentThrottle = null;
    lastSentSteering = null;
    lastControlSentAt = 0;

    if (controlFrameId === null) {
        controlFrameId = requestAnimationFrame(controlLoop);
    }
});

window.addEventListener('gamepaddisconnected', (e) => {
    if (e.gamepad.index === gamepadIdx) {
        sendControlPacket(1000, 1500, true);
        gamepadIdx = null;
        gamepadDot.className = 'indicator';
        cancelAnimationFrame(controlFrameId);
        controlFrameId = null;
    }
});

function mapRange(x, inMin, inMax, outMin, outMax) {
    return (x - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
}

function shouldSendControl(throttle, steering, now) {
    if (lastSentThrottle === null || lastSentSteering === null) {
        return true;
    }

    const throttleChanged = Math.abs(throttle - lastSentThrottle) >= CONTROL_CHANGE_THRESHOLD;
    const steeringChanged = Math.abs(steering - lastSentSteering) >= CONTROL_CHANGE_THRESHOLD;
    const keepaliveDue = now - lastControlSentAt >= CONTROL_KEEPALIVE_MS;

    return throttleChanged || steeringChanged || keepaliveDue;
}

function sendControlPacket(throttle, steering, force = false) {
    if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > MAX_WS_BUFFERED_BYTES) {
        return;
    }

    const now = performance.now();
    if (!force && !shouldSendControl(throttle, steering, now)) {
        return;
    }

    ws.send(`C${throttle},${steering}`);
    lastSentThrottle = throttle;
    lastSentSteering = steering;
    lastControlSentAt = now;
}

function sendControlData() {
    if (gamepadIdx === null) {
        return;
    }

    const gp = navigator.getGamepads()[gamepadIdx];
    if (!gp) {
        return;
    }

    const l2Raw = gp.buttons[6].value;
    const rxRaw = gp.axes[2];
    const rcThrottle = Math.round(mapRange(l2Raw, 0, 1, 1000, 2000));
    const rcSteering = Math.round(mapRange(rxRaw, -1, 1, 1000, 2000));

    if (rcThrottle !== lastDisplayedThrottle) {
        rcThrottleValue.innerText = rcThrottle;
        lastDisplayedThrottle = rcThrottle;
    }

    if (rcSteering !== lastDisplayedSteering) {
        rcSteeringValue.innerText = rcSteering;
        lastDisplayedSteering = rcSteering;
    }

    sendControlPacket(rcThrottle, rcSteering);
}

function controlLoop() {
    sendControlData();
    controlFrameId = requestAnimationFrame(controlLoop);
}
