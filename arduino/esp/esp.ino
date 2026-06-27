#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include <TinyGPSPlus.h>    // Thư viện xử lý GPS
#include <HardwareSerial.h> // Thư viện giao tiếp UART

// Cấu hình mạng và Server
const char* ssid = "VIETTEL_BINH";
const char* password = "12345678";

// Danh sách Server (Primary và Backup)
const char* primary_host = "192.168.1.184";
const int primary_port = 3000;

const char* backup_host = "play.mairapvipproforsure.id.vn";
const int backup_port = 25569;

// Trạng thái kết nối và chuyển đổi server (Failover)
bool using_backup = false;
int connection_fail_count = 0;
const int max_fail_threshold = 3;
bool should_switch_server = false;
bool is_switching_server = false;

WebSocketsClient webSocket;
Servo escMotor;
Servo steeringServo;

// Khởi tạo đối tượng GPS và cổng Serial2
TinyGPSPlus gps;
HardwareSerial gpsSerial(2);

// Khai báo chân kết nối
const int ESC_PIN = 13;
const int SERVO_PIN = 12;
const int GPS_RX_PIN = 16; // Nối với TX của NEO-6M
const int GPS_TX_PIN = 17; // Nối với RX của NEO-6M

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_DISCONNECTED:
      Serial.println("[WS] Mất kết nối! Dừng động cơ.");
      escMotor.writeMicroseconds(1000); 
      
      if (is_switching_server) {
        // Bỏ qua việc đếm lỗi nếu ngắt kết nối do chủ động chuyển đổi server
        is_switching_server = false;
        break;
      }
      
      connection_fail_count++;
      Serial.printf("[WS] Kết nối thất bại lần: %d/%d\n", connection_fail_count, max_fail_threshold);
      
      if (connection_fail_count >= max_fail_threshold) {
        using_backup = !using_backup; // Đổi sang server dự phòng/chính
        connection_fail_count = 0;
        should_switch_server = true;
      }
      break;
      
    case WStype_CONNECTED:
      Serial.println("[WS] Đã kết nối thành công!");
      connection_fail_count = 0; // Reset đếm lỗi khi kết nối thành công
      webSocket.sendTXT("{\"type\":\"register\",\"role\":\"esp32\"}");
      break;
      
    case WStype_TEXT:
      StaticJsonDocument<200> doc;
      DeserializationError error = deserializeJson(doc, payload);
      
      if (!error) {
        // ---- THÊM PHẦN NÀY ĐỂ PHẢN HỒI PING ----
        if (doc["type"] == "ping") {
          // Đọc mốc thời gian dạng String để tránh lỗi tràn bộ nhớ (overflow) của số quá lớn
          String timeStamp = doc["t"].as<String>();
          String pongPacket = "{\"type\":\"pong\",\"t\":" + timeStamp + "}";
          webSocket.sendTXT(pongPacket);
        }
        // ----------------------------------------
        
        // Phần điều khiển động cơ cũ
        if (doc.containsKey("t") && doc.containsKey("s")) {
          int rcThrottle = doc["t"];
          int rcSteering = doc["s"];
          escMotor.writeMicroseconds(rcThrottle);
          steeringServo.writeMicroseconds(rcSteering);
        }
      }
      break;
  }
}

void connectToWebSocket() {
  const char* current_host = using_backup ? backup_host : primary_host;
  int current_port = using_backup ? backup_port : primary_port;
  
  Serial.print("[WS] Đang kết nối tới: ");
  Serial.print(current_host);
  Serial.print(":");
  Serial.println(current_port);
  
  connection_fail_count = 0;
  webSocket.disconnect();
  webSocket.begin(current_host, current_port, "/");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(2000);
}

void setup() {
  Serial.begin(115200);
  
  // 1. Cấu hình Serial cho GPS
  gpsSerial.begin(9600, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  
  // 2. Gắn chân tín hiệu cho ESC và Servo ngay lập tức
  escMotor.attach(ESC_PIN, 1000, 2000);
  steeringServo.attach(SERVO_PIN, 1000, 2000);
  
  // ==========================================
  // 3. BẮT ĐẦU QUÁ TRÌNH ARMING ESC
  // ==========================================
  Serial.println("Đang Arming ESC...");
  
  // LƯU Ý QUAN TRỌNG:
  // - Nếu ESC của bạn là loại cho thuyền/ô tô RC (2 chiều có tiến có lùi): Neutral là 1500
  // - Nếu ESC của bạn là loại cho máy bay/drone (1 chiều chỉ tiến): Neutral là 1000
  escMotor.writeMicroseconds(1000); 
  
  // Đưa bánh lái về góc thẳng
  steeringServo.writeMicroseconds(1500); 
  
  // Dừng lại 4 giây. 
  // Trong lúc này ESC sẽ kêu bíp bíp (đếm số cell pin), 
  // sau đó là một tiếng BÍP DÀI xác nhận đã arm thành công.
  delay(4000); 
  Serial.println("Arming ESC hoàn tất!");
  // ==========================================

  // 4. Sau khi Arm xong, mới tiến hành kết nối WiFi (tác vụ tốn thời gian)
  WiFi.begin(ssid, password);
  Serial.print("Đang kết nối WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi đã kết nối!");

  // 5. Khởi tạo WebSocket
  connectToWebSocket();
}

void loop() {
  if (should_switch_server) {
    should_switch_server = false;
    is_switching_server = true;
    connectToWebSocket();
  }

  webSocket.loop();
  
  // 1. Liên tục đọc dữ liệu thô từ mạch NEO-6M và nạp vào thư viện TinyGPS++
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }
  
  // 2. Gửi dữ liệu GPS lên server định kỳ (Ví dụ: 1 giây gửi 1 lần)
  static unsigned long lastGPSCheck = 0;
  if (millis() - lastGPSCheck > 1000) {
    lastGPSCheck = millis();
    
    // Chỉ gửi khi GPS đã bắt được vệ tinh và có tọa độ hợp lệ
    if (gps.location.isValid()) {
      double currentLat = gps.location.lat();
      double currentLng = gps.location.lng();
      
      // Đóng gói thành chuỗi JSON
      String gpsPackage = "{\"type\":\"gps\",\"lat\":" + String(currentLat, 6) + 
                          ",\"lng\":" + String(currentLng, 6) + "}";
                          
      webSocket.sendTXT(gpsPackage);
    } else {
      // Báo log ra Serial nếu đang chờ vệ tinh (đèn xanh trên NEO-6M chưa chớp)
      Serial.println("Đang tìm tín hiệu vệ tinh...");
    }
  }
}