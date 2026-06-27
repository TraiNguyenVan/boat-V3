# Boat GPS Server

Server Node.js cho hệ thống điều khiển thuyền RC và giám sát GPS thời gian thực. Server phục vụ giao diện web trong thư mục `public/`, đồng thời làm cầu nối WebSocket giữa trình duyệt và ESP32.

## Chức năng chính

- Phục vụ giao diện điều khiển tại `http://localhost:3000`.
- Nhận tín hiệu điều khiển từ web và chuyển xuống ESP32.
- Nhận tọa độ GPS từ ESP32 và chuyển lên web.
- Chuyển tiếp gói `ping` / `pong` để đo độ trễ kết nối.

## Yêu cầu

- Node.js 18 trở lên.
- npm.
- ESP32 đã nạp chương trình trong `arduino/esp/esp.ino`.
- Máy chạy server và ESP32 cần cùng mạng LAN, hoặc ESP32 phải truy cập được tới địa chỉ server.

## Cấu hình môi trường

Server có thể sử dụng biến môi trường `PORT` để thay đổi cổng hoạt động. Bạn có thể sao chép file cấu hình mẫu:

```bash
cp .env.example .env
```

Nội dung mẫu trong `.env.example`:

```text
PORT=3000
```

Nếu không đặt `PORT`, server sẽ sử dụng giá trị mặc định `3000`.

## Cài đặt

```bash
npm install
```

## Chạy server

```bash
npm start
```

Mặc định server chạy ở:

```text
http://localhost:3000
```

Nếu muốn đổi cổng khi chạy trực tiếp:

Trên Windows PowerShell:

```powershell
$env:PORT=8080
npm start
```

Trên macOS/Linux:

```bash
PORT=8080 npm start
```

## Chạy với Docker

Nếu bạn muốn chạy server trong container Docker, docker-compose có thể sử dụng biến `PORT` từ file `.env` hoặc biến môi trường hệ thống.

```bash
docker compose up --build
```

Hoặc với Docker Compose cũ:

```bash
docker-compose up --build
```

Server sẽ được ánh xạ vào cổng đã cấu hình.

## Cấu hình ESP32

Trong file `arduino/esp/esp.ino`, sửa các giá trị sau cho đúng mạng đang dùng:

```cpp
const char* ssid = "TEN_WIFI";
const char* password = "MAT_KHAU_WIFI";
const char* server_host = "IP_MAY_CHAY_SERVER";
const int server_port = 3000;
```

Ví dụ nếu máy chạy server có IP LAN là `192.168.1.184`:

```cpp
const char* server_host = "192.168.1.184";
const int server_port = 3000;
```

Không dùng `localhost` trong ESP32, vì `localhost` trên ESP32 là chính ESP32 chứ không phải máy tính chạy server.

## Luồng kết nối

1. Web mở giao diện từ server và đăng ký WebSocket với vai trò `web`.
2. ESP32 kết nối WebSocket tới server và đăng ký vai trò `esp32`.
3. Web gửi dữ liệu điều khiển dạng `control`.
4. Server đổi dữ liệu điều khiển sang key ngắn rồi gửi xuống ESP32.
5. ESP32 gửi dữ liệu GPS lên server.
6. Server chuyển GPS tới web để cập nhật bản đồ.

## Gói tin WebSocket

### Đăng ký thiết bị

Web:

```json
{
  "type": "register",
  "role": "web"
}
```

ESP32:

```json
{
  "type": "register",
  "role": "esp32"
}
```

### Web gửi điều khiển lên server

```json
{
  "type": "control",
  "throttle": 1500,
  "steering": 1500
}
```

Server gửi xuống ESP32 ở dạng rút gọn:

```json
{
  "t": 1500,
  "s": 1500
}
```

### ESP32 gửi GPS lên server

```json
{
  "type": "gps",
  "lat": 16.82,
  "lng": 107.19
}
```

Server chuyển tiếp về web với cùng định dạng.

### Đo độ trễ

Web gửi:

```json
{
  "type": "ping",
  "t": 1718850000000
}
```

ESP32 phản hồi:

```json
{
  "type": "pong",
  "t": 1718850000000
}
```

## Cấu trúc thư mục

```text
.
├── arduino/
│   └── esp/
│       └── esp.ino
├── public/
│   ├── app.js
│   ├── index.html
│   └── style.css
├── package.json
├── package-lock.json
├── README.md
└── server.js
```

## Ghi chú khi chạy thực tế

- Mở trình duyệt tại địa chỉ IP của máy chạy server nếu điều khiển từ thiết bị khác trong cùng mạng, ví dụ `http://192.168.1.184:3000`.
- Nếu ESP32 không kết nối được, kiểm tra IP LAN của máy chạy server, cổng `3000`, firewall và WiFi.
- Nếu bản đồ không hiển thị, kiểm tra kết nối internet của thiết bị mở giao diện web.
- Nếu tay cầm không gửi tín hiệu, kiểm tra trình duyệt có nhận Gamepad API và tay cầm đã được kết nối chưa.
