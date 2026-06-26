const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Phục vụ giao diện web từ thư mục public
app.use(express.static(path.join(__dirname, 'public')));

let esp32Client = null;
let webClient = null;

wss.on('connection', (ws) => {
    console.log('-> Có kết nối mới vào Server');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            // Xác thực và phân loại thiết bị khi kết nối lần đầu
            if (data.type === 'register') {
                if (data.role === 'esp32') {
                    esp32Client = ws;
                    console.log('--- [OK] ESP32 đã kết nối thành công ---');
                } else if (data.role === 'web') {
                    webClient = ws;
                    console.log('--- [OK] Giao diện Web đã kết nối thành công ---');
                }
                return;
            }

            // Chuyển tiếp tín hiệu điều khiển từ Web -> ESP32
            if (data.type === 'control') {
                if (esp32Client && esp32Client.readyState === WebSocket.OPEN) {
                    esp32Client.send(JSON.stringify({
                        t: data.throttle, // Tối ưu hóa tên key ngắn gọn để giảm dung lượng gói tin
                        s: data.steering
                    }));
                }
            }

            // Chuyển tiếp tọa độ GPS từ ESP32 -> Web
            if (data.type === 'gps') {
                if (webClient && webClient.readyState === WebSocket.OPEN) {
                    webClient.send(JSON.stringify({
                        type: 'gps',
                        lat: data.lat,
                        lng: data.lng
                    }));
                }
            }

            // Chuyển tiếp gói tin Ping từ Web xuống ESP32
            if (data.type === 'ping' && esp32Client && esp32Client.readyState === WebSocket.OPEN) {
                esp32Client.send(message.toString());
            }

            // Chuyển tiếp gói tin Pong từ ESP32 phản hồi lên lại Web
            if (data.type === 'pong' && webClient && webClient.readyState === WebSocket.OPEN) {
                webClient.send(message.toString());
            }

        } catch (error) {
            console.error('Lỗi giải mã dữ liệu JSON:', error);
        }
    });

    ws.on('close', () => {
        if (ws === esp32Client) {
            console.log('X Mất kết nối với ESP32');
            esp32Client = null;
        } else if (ws === webClient) {
            console.log('X Mất kết nối với giao diện Web');
            webClient = null;
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`=== SERVER ĐANG CHẠY TẠI HỒ SƠ http://localhost:${PORT} ===`);
});