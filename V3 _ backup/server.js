const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);

// ==========================================
// TỐI ƯU #1: Tắt nén WebSocket (perMessageDeflate)
// Mặc định ws bật nén zlib → tốn CPU giải nén + thêm latency mỗi gói.
// Control 20Hz & GPS không cần nén vì payload đã rất nhỏ (~30 bytes).
// ==========================================
const wss = new WebSocket.Server({
    server,
    perMessageDeflate: false,
    maxPayload: 1024 * 4 // Giới hạn 4KB/gói, tránh OOM nếu bị tấn công
});

app.use(express.static(path.join(__dirname, 'public')));

let esp32Client = null;
let webClient = null;

// Cache readyState constant để tránh property lookup lặp lại
const WS_OPEN = WebSocket.OPEN;

wss.on('connection', (ws, req) => {

    // ==========================================
    // TỐI ƯU #2: Tắt Nagle's Algorithm (TCP_NODELAY)
    // Nagle gom các gói TCP nhỏ lại rồi mới gửi → thêm 10-40ms độ trễ.
    // Với real-time control, ta muốn mỗi gói được gửi NGAY LẬP TỨC.
    // ==========================================
    if (ws._socket) {
        ws._socket.setNoDelay(true);
    }

    console.log(`-> Kết nối mới từ ${req.socket.remoteAddress}`);

    // Đánh dấu connection còn sống (dùng cho heartbeat bên dưới)
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (rawMessage) => {

        // Chuyển Buffer → String 1 lần duy nhất, tái sử dụng cho ping/pong forward
        const message = rawMessage.toString();

        let data;
        try {
            data = JSON.parse(message);
        } catch {
            return; // Gói lỗi → bỏ qua ngay, không log để tránh I/O blocking
        }

        const type = data.type;

        // ==========================================
        // TỐI ƯU #3: Early return sau mỗi nhánh
        // Code cũ dùng if-if-if → server check TẤT CẢ điều kiện dù đã match.
        // Dùng return sau mỗi nhánh → thoát ngay, tiết kiệm CPU ở hot path.
        // ==========================================

        // REGISTER
        if (type === 'register') {
            if (data.role === 'esp32') {
                esp32Client = ws;
                console.log('--- [OK] ESP32 đã kết nối ---');
            } else if (data.role === 'web') {
                webClient = ws;
                console.log('--- [OK] Giao diện Web đã kết nối ---');
            }
            return; // ← Early return
        }

        // CONTROL: Web → ESP32 (critical path, 20Hz)
        if (type === 'control') {
            if (esp32Client && esp32Client.readyState === WS_OPEN) {
                // ==========================================
                // TỐI ƯU #4: Template literal thay vì JSON.stringify()
                // JSON.stringify({t, s}) phải allocate object mới + duyệt key mỗi lần.
                // Template literal build string trực tiếp → nhanh hơn ~30-40%.
                // ==========================================
                esp32Client.send(`{"t":${data.throttle},"s":${data.steering}}`);
            }
            return;
        }

        // GPS: ESP32 → Web
        if (type === 'gps') {
            if (webClient && webClient.readyState === WS_OPEN) {
                // Tương tự, dùng template literal
                webClient.send(`{"type":"gps","lat":${data.lat},"lng":${data.lng}}`);
            }
            return;
        }

        // PING: Web → ESP32 — forward raw string, KHÔNG parse/stringify lại
        if (type === 'ping') {
            if (esp32Client && esp32Client.readyState === WS_OPEN) {
                esp32Client.send(message); // message đã là string rồi, dùng thẳng
            }
            return;
        }

        // PONG: ESP32 → Web — tương tự, forward nguyên bản
        if (type === 'pong') {
            if (webClient && webClient.readyState === WS_OPEN) {
                webClient.send(message);
            }
            return;
        }
    });

    ws.on('close', () => {
        if (ws === esp32Client) {
            console.log('X Mất kết nối ESP32');
            esp32Client = null;
        } else if (ws === webClient) {
            console.log('X Mất kết nối Web');
            webClient = null;
        }
    });

    // Bắt lỗi socket để tránh server crash khi ESP32 ngắt đột ngột
    ws.on('error', (err) => {
        console.error(`[WS Error] ${req.socket.remoteAddress}: ${err.message}`);
    });
});

// ==========================================
// TỐI ƯU #5: Heartbeat – phát hiện "zombie connection" nhanh hơn
// Khi ESP32 mất điện đột ngột, TCP không gửi FIN → server nghĩ vẫn còn kết nối.
// Ping WebSocket mỗi 5 giây, nếu không nhận pong → terminate() ngay.
// Giúp tránh gửi control vào một connection đã chết (gây trễ do buffer đầy).
// ==========================================
const HEARTBEAT_INTERVAL = 5000; // ms

const heartbeatTimer = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log('! Zombie connection → terminate');
            ws.terminate();
            return;
        }
        ws.isAlive = false;
        ws.ping(); // Browser/ESP32 tự động reply pong, event handler ở trên catch
    });
}, HEARTBEAT_INTERVAL);

// Dọn dẹp timer khi server tắt
wss.on('close', () => clearInterval(heartbeatTimer));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`=== SERVER CHẠY TẠI http://localhost:${PORT} ===`);
});