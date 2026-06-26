#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include <TinyGPSPlus.h>    // Thư viện xử lý GPS
#include <HardwareSerial.h> // Thư viện giao tiếp UART

// Cấu hình mạng và Server
const char* ssid = "VIETTEL_BINH";
const char* password = "12345678";
const char* server_host = "192.168.1.184"; 
const int server_port = 3000;

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
      break;
      
    case WStype_CONNECTED:
      Serial.println("[WS] Đã kết nối thành công!");
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
  webSocket.begin(server_host, server_port, "/");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(2000);
}

void loop() {
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