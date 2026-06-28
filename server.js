require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({
    server,
    perMessageDeflate: false
});

app.use(express.static(path.join(__dirname, 'public')));

let esp32Client = null;
let webClient = null;
const WS_SEND_OPTIONS = { compress: false };
const CONTROL_MAX_BUFFERED_BYTES = 128;

function sendIfOpen(client, payload, maxBufferedBytes = Infinity) {
    if (client && client.readyState === WebSocket.OPEN && client.bufferedAmount <= maxBufferedBytes) {
        client.send(payload, WS_SEND_OPTIONS);
    }
}

function isFiniteNumberText(value) {
    return value.length > 0 && Number.isFinite(Number(value));
}

function relayCompactControl(text) {
    const command = text[0];

    if (command === 'C') {
        const comma = text.indexOf(',');
        if (comma <= 1) {
            return false;
        }

        const throttle = text.slice(1, comma);
        const steering = text.slice(comma + 1);
        if (isFiniteNumberText(throttle) && isFiniteNumberText(steering)) {
            sendIfOpen(esp32Client, text, CONTROL_MAX_BUFFERED_BYTES);
            return true;
        }
    }

    if (command === 'T') {
        const trim = text.slice(1);
        if (isFiniteNumberText(trim)) {
            sendIfOpen(esp32Client, text, CONTROL_MAX_BUFFERED_BYTES);
            return true;
        }
    }

    return false;
}

wss.on('connection', (ws) => {
    console.log('-> New WebSocket connection');
    ws._socket.setNoDelay(true);

    ws.on('message', (message) => {
        try {
            const text = message.toString();

            if (text[0] === 'Q') {
                const rawTimestamp = text.slice(1);
                const timestamp = Number(rawTimestamp);
                if (rawTimestamp.length > 0 && Number.isFinite(timestamp)) {
                    sendIfOpen(webClient, `{"type":"q","t":${timestamp}}`);
                }
                return;
            }

            if (text[0] === 'C' || text[0] === 'T') {
                relayCompactControl(text);
                return;
            }

            if (text[0] === 'P') {
                const rawTimestamp = text.slice(1);
                const timestamp = Number(rawTimestamp);
                if (rawTimestamp.length > 0 && Number.isFinite(timestamp)) {
                    sendIfOpen(esp32Client, text);
                }
                return;
            }

            const data = JSON.parse(text);

            if (data.type === 'register') {
                if (data.role === 'esp32') {
                    esp32Client = ws;
                    console.log('--- [OK] ESP32 connected ---');
                } else if (data.role === 'web') {
                    webClient = ws;
                    console.log('--- [OK] Web UI connected ---');
                }
                return;
            }

            if (data.type === 'control' || data.type === 'c') {
                const throttle = data.t ?? data.throttle;
                const steering = data.s ?? data.steering;
                if (Number.isFinite(throttle) && Number.isFinite(steering)) {
                    sendIfOpen(esp32Client, `C${Math.round(throttle)},${Math.round(steering)}`, CONTROL_MAX_BUFFERED_BYTES);
                }
                return;
            }

            if (data.type === 'trim' || data.type === 't') {
                const trim = data.v ?? data.trim;
                if (Number.isFinite(trim)) {
                    sendIfOpen(esp32Client, `T${Math.round(trim)}`, CONTROL_MAX_BUFFERED_BYTES);
                }
                return;
            }

            if (data.type === 'gps') {
                sendIfOpen(webClient, `{"type":"gps","lat":${data.lat},"lng":${data.lng}}`);
                return;
            }

            if (data.type === 'ping' || data.type === 'p') {
                const timestamp = data.t ?? Date.now();
                if (Number.isFinite(timestamp)) {
                    sendIfOpen(esp32Client, `P${timestamp}`);
                }
                return;
            }

            if (data.type === 'pong' || data.type === 'q') {
                sendIfOpen(webClient, text);
            }
        } catch (error) {
            console.error('JSON parse error:', error.message);
        }
    });

    ws.on('close', () => {
        if (ws === esp32Client) {
            console.log('X ESP32 disconnected');
            esp32Client = null;
        } else if (ws === webClient) {
            console.log('X Web UI disconnected');
            webClient = null;
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error.message);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`=== SERVER RUNNING AT http://localhost:${PORT} ===`);
});
