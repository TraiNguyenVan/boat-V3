// ==========================================
// 1. CẤU HÌNH KẾT NỐI WEBSOCKET
// ==========================================
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${wsProtocol}//${window.location.host}`;
const ws = new WebSocket(wsUrl);

const wsDot = document.getElementById('ws-dot');
const gamepadDot = document.getElementById('gamepad-dot');

ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'register', role: 'web' }));
    wsDot.className = "indicator active"; // Đèn chuyển xanh
};

ws.onclose = () => {
    wsDot.className = "indicator"; // Đèn về đỏ
};

// ==========================================
// 2. BẢN ĐỒ LEAFLET, HOME POINT & CHẤM XANH
// ==========================================
// Khởi tạo bản đồ, tắt nút zoom (+/-) để nhìn giống app FPV hơn
const map = L.map('map', { zoomControl: false }).setView([16.82, 107.19], 13);

// Bản đồ vệ tinh Google (Chỉ ảnh vệ tinh, không có chữ đường phố)
L.tileLayer('http://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    maxZoom: 20,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
    attribution: '© Google'
}).addTo(map);

/* Nếu bạn muốn dùng Google Hybrid (Vệ tinh + Tên đường + Tên địa danh) 
thì đổi 'lyrs=s' thành 'lyrs=y' ở link trên nhé.
*/

// Thiết kế biểu tượng chấm xanh dương (thuyền)
const boatIcon = L.divIcon({
    className: 'boat-blue-dot',
    iconSize: [16, 16],
    iconAnchor: [8, 8]
});

let boatMarker = null;
let homeMarker = null;
let homeLatLng = null;
let currentLatLng = null;

// Nút SET HOME POINT
document.getElementById('btn-set-home').addEventListener('click', () => {
    if (!currentLatLng) {
        alert("Chưa có tọa độ GPS hiện tại!");
        return;
    }
    
    homeLatLng = currentLatLng;
    
    // Vẽ điểm Home bằng một hình tròn nhỏ màu cam/vàng
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

// Biến đếm để gửi Ping mỗi giây
setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
        // Gửi gói ping với mốc thời gian hiện tại (millisecond)
        ws.send(JSON.stringify({ type: 'ping', t: Date.now() }));
    }
}, 1000); // Mỗi 1 giây đo độ trễ 1 lần

ws.onmessage = (event) => {
    try {
        const data = JSON.parse(event.data);
        
        // 1. Nhận gói Pong và tính độ trễ
        if (data.type === 'pong') {
            const latency = Date.now() - data.t;
            document.getElementById('ping-value').innerHTML = `${latency} <small>ms</small>`;
        }
        
        // 2. Nhận gói GPS (Đã xóa phần đọc tốc độ)
        if (data.type === 'gps' && data.lat && data.lng) {
            currentLatLng = L.latLng(data.lat, data.lng);
            document.getElementById('gps-value').innerText = `${data.lat.toFixed(5)}, ${data.lng.toFixed(5)}`;
            
            // Tính khoảng cách đến Home
            if (homeLatLng) {
                const distance = currentLatLng.distanceTo(homeLatLng);
                document.getElementById('distance-value').innerHTML = `${distance.toFixed(0)} <small>m</small>`;
            }

            // Vẽ thuyền
            if (!boatMarker) {
                boatMarker = L.marker(currentLatLng, { icon: boatIcon }).addTo(map);
                map.setView(currentLatLng, 16); 
            } else {
                boatMarker.setLatLng(currentLatLng);
            }
        }
    } catch (err) {
        console.error("Lỗi đọc dữ liệu WebSocket:", err);
    }
};

// ==========================================
// 3. TAY CẦM PS4 & CHUYỂN ĐỔI RC
// ==========================================
let gamepadIdx = null;
let controlInterval = null;

window.addEventListener("gamepadconnected", (e) => {
    gamepadIdx = e.gamepad.index;
    gamepadDot.className = "indicator active"; // Đèn tay cầm chuyển xanh
    
    // Tần số quét 20Hz (50ms)
    controlInterval = setInterval(sendControlData, 50);
});

window.addEventListener("gamepaddisconnected", (e) => {
    if (e.gamepad.index === gamepadIdx) {
        gamepadIdx = null;
        gamepadDot.className = "indicator"; // Đèn tay cầm về đỏ
        clearInterval(controlInterval);
    }
});

function mapRange(x, in_min, in_max, out_min, out_max) {
    return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}

function sendControlData() {
    if (gamepadIdx === null) return;

    const gamepads = navigator.getGamepads();
    const gp = gamepads[gamepadIdx];
    if (!gp) return;

    // L2 (Nút Trigger) -> Ga tiến
    // Map về 1000 - 2000 (Neutral là 1000 theo cấu hình của bạn)
    let l2Raw = gp.buttons[6].value;
    let rcThrottle = Math.round(mapRange(l2Raw, 0, 1, 1000, 2000));

    // Rx (Trục X Joystick Phải) -> Bẻ lái
    // Map về 1000 - 2000 (Neutral là 1500)
    let rxRaw = gp.axes[2];
    let rcSteering = Math.round(mapRange(rxRaw, -1, 1, 1000, 2000));

    // Hiển thị ra UI
    document.getElementById('rc-throttle').innerText = rcThrottle;
    document.getElementById('rc-steering').innerText = rcSteering;

    // Gửi xuống Server
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'control',
            throttle: rcThrottle,
            steering: rcSteering
        }));
    }
}