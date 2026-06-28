#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ESP32Servo.h>
#include <TinyGPSPlus.h>
#include <HardwareSerial.h>

// Cau hinh mang va server
const char* ssid = "BOAT";
const char* password = "00000000";
const char* server_host = "171.242.239.103";
const int server_port = 3000;

WebSocketsClient webSocket;
Servo escMotor;
Servo steeringServo;

TinyGPSPlus gps;
HardwareSerial gpsSerial(2);

const int ESC_PIN = 13;
const int SERVO_PIN = 12;
const int GPS_RX_PIN = 16;
const int GPS_TX_PIN = 17;

const int THROTTLE_MIN_US = 1000;
const int THROTTLE_MAX_US = 2000;
const int STEERING_MIN_US = 1000;
const int STEERING_MAX_US = 2000;
const int THROTTLE_SAFE_US = 1000;
const int STEERING_CENTER_US = 1500;
const int STEERING_TRIM_MIN_US = -200;
const int STEERING_TRIM_MAX_US = 200;
const uint16_t SERVO_UPDATE_INTERVAL_MS = 10;
const uint16_t CONTROL_TIMEOUT_MS = 600;
const int THROTTLE_STEP_MIN_US = 8;
const int THROTTLE_STEP_MAX_US = 70;
const int STEERING_STEP_MIN_US = 10;
const int STEERING_STEP_MAX_US = 90;

int targetThrottleUs = THROTTLE_SAFE_US;
int targetRawSteeringUs = STEERING_CENTER_US;
int targetSteeringUs = STEERING_CENTER_US;
int currentThrottleUs = THROTTLE_SAFE_US;
int currentSteeringUs = STEERING_CENTER_US;
int steeringTrimUs = 0;
unsigned long lastServoUpdateMs = 0;
unsigned long lastControlPacketMs = 0;

int stepToward(int current, int target, int maxStep) {
  if (current < target) {
    return min(current + maxStep, target);
  }
  if (current > target) {
    return max(current - maxStep, target);
  }
  return current;
}

int adaptiveStep(int current, int target, int minStep, int maxStep) {
  const int delta = abs(target - current);
  if (delta == 0) {
    return 0;
  }
  return constrain(delta / 3, minStep, maxStep);
}

int applySteeringTrim(int steering) {
  return constrain(steering + steeringTrimUs, STEERING_MIN_US, STEERING_MAX_US);
}

bool parseUnsignedField(const uint8_t* payload, size_t start, size_t end, int& value) {
  if (start >= end) {
    return false;
  }

  int parsed = 0;
  for (size_t i = start; i < end; i++) {
    if (payload[i] < '0' || payload[i] > '9') {
      return false;
    }
    parsed = parsed * 10 + payload[i] - '0';
  }

  value = parsed;
  return true;
}

bool parseSignedField(const uint8_t* payload, size_t start, size_t end, int& value) {
  if (start >= end) {
    return false;
  }

  bool negative = false;
  if (payload[start] == '-' || payload[start] == '+') {
    negative = payload[start] == '-';
    start++;
  }

  int parsed = 0;
  if (!parseUnsignedField(payload, start, end, parsed)) {
    return false;
  }

  value = negative ? -parsed : parsed;
  return true;
}

void setControlTargets(int throttle, int steering) {
  targetThrottleUs = constrain(throttle, THROTTLE_MIN_US, THROTTLE_MAX_US);
  targetRawSteeringUs = constrain(steering, STEERING_MIN_US, STEERING_MAX_US);
  targetSteeringUs = applySteeringTrim(targetRawSteeringUs);
  lastControlPacketMs = millis();
}

void updateServos() {
  const unsigned long now = millis();
  if (lastControlPacketMs != 0 && now - lastControlPacketMs > CONTROL_TIMEOUT_MS) {
    targetThrottleUs = THROTTLE_SAFE_US;
    targetRawSteeringUs = STEERING_CENTER_US;
    targetSteeringUs = applySteeringTrim(targetRawSteeringUs);
    lastControlPacketMs = 0;
  }

  if (now - lastServoUpdateMs < SERVO_UPDATE_INTERVAL_MS) {
    return;
  }
  lastServoUpdateMs = now;

  const int throttleStep = adaptiveStep(currentThrottleUs, targetThrottleUs, THROTTLE_STEP_MIN_US, THROTTLE_STEP_MAX_US);
  const int steeringStep = adaptiveStep(currentSteeringUs, targetSteeringUs, STEERING_STEP_MIN_US, STEERING_STEP_MAX_US);
  const int nextThrottle = stepToward(currentThrottleUs, targetThrottleUs, throttleStep);
  const int nextSteering = stepToward(currentSteeringUs, targetSteeringUs, steeringStep);

  if (nextThrottle != currentThrottleUs) {
    currentThrottleUs = nextThrottle;
    escMotor.writeMicroseconds(currentThrottleUs);
  }

  if (nextSteering != currentSteeringUs) {
    currentSteeringUs = nextSteering;
    steeringServo.writeMicroseconds(currentSteeringUs);
  }
}

void stopMotor() {
  targetThrottleUs = THROTTLE_SAFE_US;
  targetRawSteeringUs = STEERING_CENTER_US;
  targetSteeringUs = applySteeringTrim(targetRawSteeringUs);
  currentThrottleUs = THROTTLE_SAFE_US;
  currentSteeringUs = targetSteeringUs;
  escMotor.writeMicroseconds(currentThrottleUs);
  steeringServo.writeMicroseconds(currentSteeringUs);
}

void sendPong(const uint8_t* payload, size_t length) {
  if (length <= 1) {
    return;
  }

  char packet[32];
  const size_t timestampLength = min(length - 1, sizeof(packet) - 2);

  packet[0] = 'Q';
  memcpy(packet + 1, payload + 1, timestampLength);
  packet[timestampLength + 1] = '\0';
  webSocket.sendTXT(packet);
}

bool parseControlPacket(const uint8_t* payload, size_t length, int& throttle, int& steering) {
  if (length < 8 || length >= 32 || payload[0] != 'C') {
    return false;
  }

  size_t commaIndex = 0;
  for (size_t i = 1; i < length; i++) {
    if (payload[i] == ',') {
      commaIndex = i;
      break;
    }
  }

  if (commaIndex == 0) {
    return false;
  }

  int parsedThrottle = 0;
  int parsedSteering = 0;

  if (!parseUnsignedField(payload, 1, commaIndex, parsedThrottle) ||
      !parseUnsignedField(payload, commaIndex + 1, length, parsedSteering)) {
    return false;
  }

  throttle = constrain(parsedThrottle, THROTTLE_MIN_US, THROTTLE_MAX_US);
  steering = constrain(parsedSteering, STEERING_MIN_US, STEERING_MAX_US);
  return true;
}

bool parseTrimPacket(const uint8_t* payload, size_t length, int& trim) {
  if (length < 2 || length >= 8 || payload[0] != 'T') {
    return false;
  }

  int parsedTrim = 0;
  if (!parseSignedField(payload, 1, length, parsedTrim)) {
    return false;
  }

  trim = constrain(parsedTrim, STEERING_TRIM_MIN_US, STEERING_TRIM_MAX_US);
  return true;
}

void handleWebSocketText(uint8_t* payload, size_t length) {
  if (length == 0) {
    return;
  }

  if (payload[0] == 'C') {
    int rcThrottle = 1000;
    int rcSteering = 1500;
    if (parseControlPacket(payload, length, rcThrottle, rcSteering)) {
      setControlTargets(rcThrottle, rcSteering);
    }
    return;
  }

  if (payload[0] == 'T') {
    int parsedTrim = 0;
    if (parseTrimPacket(payload, length, parsedTrim)) {
      steeringTrimUs = parsedTrim;
      targetSteeringUs = applySteeringTrim(targetRawSteeringUs);
      Serial.printf("[CTRL] Steering trim: %+d us\n", steeringTrimUs);
    }
    return;
  }

  if (payload[0] == 'P') {
    sendPong(payload, length);
  }
}

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.println("[WS] Disconnected, stopping motor.");
      stopMotor();
      break;

    case WStype_CONNECTED:
      Serial.println("[WS] Connected.");
      webSocket.sendTXT("{\"type\":\"register\",\"role\":\"esp32\"}");
      break;

    case WStype_TEXT:
      handleWebSocketText(payload, length);
      break;

    default:
      break;
  }
}

void setup() {
  Serial.begin(115200);
  gpsSerial.begin(9600, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);

  escMotor.attach(ESC_PIN, 1000, 2000);
  steeringServo.attach(SERVO_PIN, 1000, 2000);

  Serial.println("Arming ESC...");
  stopMotor();
  delay(4000);
  Serial.println("ESC armed.");

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(ssid, password);

  Serial.print("Connecting WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(250);
    Serial.print(".");
  }


  webSocket.begin(server_host, server_port, "/");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(1000);
}

void loop() {
  webSocket.loop();
  updateServos();

  uint16_t gpsBytes = 0;
  while (gpsSerial.available() > 0 && gpsBytes < 32) {
    gps.encode(gpsSerial.read());
    gpsBytes++;
  }

  webSocket.loop();
  updateServos();

  static unsigned long lastGPSCheck = 0;
  static unsigned long lastNoGPSLog = 0;
  if (millis() - lastGPSCheck > 1000) {
    lastGPSCheck = millis();

    if (gps.location.isValid() && gps.location.isUpdated()) {
      char gpsPackage[96];
      snprintf(
        gpsPackage,
        sizeof(gpsPackage),
        "{\"type\":\"gps\",\"lat\":%.6f,\"lng\":%.6f}",
        gps.location.lat(),
        gps.location.lng()
      );
      webSocket.sendTXT(gpsPackage);
    } else if (!gps.location.isValid() && millis() - lastNoGPSLog > 5000) {
      lastNoGPSLog = millis();
      Serial.println("Waiting for GPS signal...");
    }
  }
}
