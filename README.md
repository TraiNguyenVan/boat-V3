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

1. Web mở giao diện từ server và đăng ký WebSocket với vai trò `web` (JSON).
2. ESP32 kết nối WebSocket tới server và đăng ký vai trò `esp32` (JSON).
3. Web gửi dữ liệu điều khiển qua gói tin text rút gọn dạng `C<throttle>,<steering>` để đạt độ trễ cực thấp.
4. Server chuyển tiếp trực tiếp gói tin text xuống ESP32 không qua phân tích JSON.
5. ESP32 gửi dữ liệu GPS thô dạng JSON lên server.
6. Server chuyển tiếp GPS tới web để cập nhật vị trí bản đồ Leaflet.

## Gói tin WebSocket

### Đăng ký thiết bị (Định dạng JSON)

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

### Điều khiển thời gian thực (Định dạng text siêu nhẹ)

Web gửi điều khiển trực tiếp (hoặc Server tự động chuyển đổi từ gói JSON cũ):

```text
C<throttle_us>,<steering_us>
```
*Ví dụ:* `C1500,1500` (giá trị từ `1000` đến `2000` microseconds).

### Hiệu chỉnh góc lái (Steering Trim - Định dạng text)

Web gửi hiệu chỉnh góc lệch bánh lái:

```text
T<trim_us>
```
*Ví dụ:* `T-15` (giá trị từ `-200` đến `200` microseconds).

### ESP32 gửi GPS lên server (Định dạng JSON)

```json
{
  "type": "gps",
  "lat": 16.82,
  "lng": 107.19
}
```

Server chuyển tiếp về web với cùng định dạng.

### Đo độ trễ kết nối (Ping/Pong text)

Web gửi gói ping định kỳ mỗi 500ms:

```text
P<timestamp>
```
*Ví dụ:* `P1718850000000`

ESP32 nhận được sẽ phản hồi ngay lập tức:

```text
Q<timestamp>
```
*Ví dụ:* `Q1718850000000`

Server nhận được gói phản hồi `Q` sẽ chuyển đổi thành dạng JSON gửi về web client:

```json
{
  "type": "q",
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
