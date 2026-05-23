import React, { useState } from "react";
import { Check, Copy, ExternalLink, Cpu, HardDrive } from "lucide-react";

interface ESPCodeBlockProps {
  wsUrl: string;
  panMin: number;
  panMax: number;
  tiltMin: number;
  tiltMax: number;
}

export const ESPCodeBlock: React.FC<ESPCodeBlockProps> = ({
  wsUrl,
  panMin,
  panMax,
  tiltMin,
  tiltMax,
}) => {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"secure" | "local">("secure");
  
  // Extract domain or host for local setup demonstration
  let localIPPlaceholder = "192.168.1.32";
  let hostStr = wsUrl;
  let portStr = "3000";
  let isSecure = wsUrl.startsWith("wss");

  try {
    const urlObj = new URL(wsUrl.replace("wss://", "https://").replace("ws://", "http://"));
    hostStr = urlObj.hostname;
    portStr = urlObj.port || (isSecure ? "443" : "3000");
  } catch (e) {
    // fallback
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(generateCode());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const generateCode = () => {
    const isWSS = activeTab === "secure";
    
    return `/**
 * ============================================================
 *  4DOF Robotic Arm - ESP32 WebSocket Controller
 *  Library : ESP32Servo, WebSocketsClient, ArduinoJson
 *  Servo   : Base(13) Shoulder(18) Elbow(19) Gripper(21)
 * ============================================================
 */

#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>

// WiFi Configuration
const char* WIFI_SSID = "NAMA_WIFI_ANDA";
const char* WIFI_PASSWORD = "PASSWORD_WIFI_ANDA";

// WebSocket Server Configuration
${
  isWSS
    ? `// Secure WSS (Cloud)
const char* WS_HOST = "${hostStr}";
const int WS_PORT = ${portStr};
const char* WS_URL = "/?role=esp32";`
    : `// Local WS (Same network)
const char* WS_HOST = "${localIPPlaceholder}"; // Ganti dengan IP komputer Anda
const int WS_PORT = 3000;
const char* WS_URL = "/?role=esp32";`
}

// Servo Pins
const int PIN_BASE = 13;
const int PIN_SHOULDER = 18;
const int PIN_ELBOW = 19;
const int PIN_GRIPPER = 21;
const int PIN_LED = 2;

// Servo PWM config
const int SERVO_MIN_US = 500;
const int SERVO_MAX_US = 2400;
const int SERVO_FREQ = 50;

struct ServoLimit {
  int minAngle;
  int maxAngle;
};

const ServoLimit LIMIT_BASE = {0, 180};
const ServoLimit LIMIT_SHOULDER = {20, 160};
const ServoLimit LIMIT_ELBOW = {0, 180};
const ServoLimit LIMIT_GRIPPER = {0, 90};

const float SERVO_SPEED = 2.0f;
const float DEADZONE = 0.12f;
const int LOOP_DELAY_MS = 20;

struct ServoState {
  float current;
  float target;
  Servo servo;
};

ServoState base, shoulder, elbow, gripper;
WebSocketsClient webSocket;
bool wsConnected = false;

unsigned long lastTelemetryMs = 0;
const unsigned long TELEMETRY_INTERVAL = 5000;

float applyDeadzone(float value) {
  if (fabsf(value) < DEADZONE) return 0.0f;
  float sign = (value > 0.0f) ? 1.0f : -1.0f;
  return sign * (fabsf(value) - DEADZONE) / (1.0f - DEADZONE);
}

void stepServo(ServoState& s, const ServoLimit& limit) {
  s.target = constrain(s.target, (float)limit.minAngle, (float)limit.maxAngle);
  float diff = s.target - s.current;
  if (fabsf(diff) < 0.5f) return;
  float step = constrain(diff, -SERVO_SPEED, SERVO_SPEED);
  s.current += step;
  s.servo.write((int)s.current);
}

void initServo(ServoState& s, int pin, int initialAngle, const ServoLimit& limit) {
  s.servo.setPeriodHertz(SERVO_FREQ);
  s.servo.attach(pin, SERVO_MIN_US, SERVO_MAX_US);
  s.current = (float)constrain(initialAngle, limit.minAngle, limit.maxAngle);
  s.target = s.current;
  s.servo.write((int)s.current);
}

void handleControlMessage(const JsonDocument& doc) {
  float lx = applyDeadzone(doc["lx"] | 0.0f);
  float ly = applyDeadzone(doc["ly"] | 0.0f);
  float ry = applyDeadzone(doc["ry"] | 0.0f);
  bool r1 = doc["r1"] | false;
  bool l1 = doc["l1"] | false;
  float spd = doc["speed"] | SERVO_SPEED;
  spd = constrain(spd, 0.5f, 10.0f);

  base.target += lx * spd;
  shoulder.target -= ly * spd;
  elbow.target -= ry * spd;

  if (r1) gripper.target += spd;
  if (l1) gripper.target -= spd;

  Serial.printf("[CTRL] Base=%.1f Shldr=%.1f Elbow=%.1f Grpr=%.1f | lx=%.2f ly=%.2f ry=%.2f R1=%d L1=%d\n",
    base.target, shoulder.target, elbow.target, gripper.target,
    lx, ly, ry, r1, l1);
}

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      wsConnected = false;
      digitalWrite(PIN_LED, LOW);
      Serial.println("[WS] Terputus dari server");
      break;

    case WStype_CONNECTED:
      wsConnected = true;
      digitalWrite(PIN_LED, HIGH);
      Serial.printf("[WS] Terhubung ke %s\n", payload);
      webSocket.sendTXT("{\"type\":\"hello\",\"device\":\"esp32-arm\"}");
      break;

    case WStype_TEXT: {
      StaticJsonDocument<256> doc;
      DeserializationError err = deserializeJson(doc, payload, length);
      if (err) {
        Serial.printf("[WS] JSON error: %s\n", err.f_str());
        return;
      }

      const char* msgType = doc["type"] | "";
      if (strcmp(msgType, "control") == 0) {
        handleControlMessage(doc);
      } else if (strcmp(msgType, "reset") == 0) {
        base.target = 90.0f;
        shoulder.target = 90.0f;
        elbow.target = 90.0f;
        gripper.target = 45.0f;
        Serial.println("[WS] Reset ke posisi home");
      }
      break;
    }
    default:
      break;
  }
}

void sendTelemetry() {
  if (!wsConnected) return;

  StaticJsonDocument<256> doc;
  doc["type"] = "telemetry";
  doc["wifiRSSI"] = WiFi.RSSI();
  doc["heapFree"] = ESP.getFreeHeap();
  doc["uptime"] = millis() / 1000;
  doc["baseAngle"] = (int)base.current;
  doc["shldAngle"] = (int)shoulder.current;
  doc["elbwAngle"] = (int)elbow.current;
  doc["grprAngle"] = (int)gripper.current;

  String out;
  serializeJson(doc, out);
  webSocket.sendTXT(out);
}

void setup() {
  Serial.begin(115200);
  Serial.println("\n=== 4DOF Robotic Arm - ESP32 WebSocket ===");

  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);

  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);

  initServo(base, PIN_BASE, 90, LIMIT_BASE);
  initServo(shoulder, PIN_SHOULDER, 90, LIMIT_SHOULDER);
  initServo(elbow, PIN_ELBOW, 90, LIMIT_ELBOW);
  initServo(gripper, PIN_GRIPPER, 45, LIMIT_GRIPPER);

  delay(1000);

  Serial.printf("[WIFI] Menghubungkan ke %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int wifiRetry = 0;
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    if (++wifiRetry > 40) {
      Serial.println("\n[WIFI] Gagal! Restart dalam 3 detik...");
      delay(3000);
      ESP.restart();
    }
  }

  Serial.printf("\n[WIFI] Terhubung | IP: %s | RSSI: %d dBm\n",
    WiFi.localIP().toString().c_str(), WiFi.RSSI());

  ${
    isWSS
      ? `webSocket.beginSslWithClient(WS_HOST, WS_PORT, WS_URL);`
      : `webSocket.begin(WS_HOST, WS_PORT, WS_URL);`
  }
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(3000);

  Serial.printf("[WS] Target: ws://%s:%d%s\n", WS_HOST, WS_PORT, WS_URL);
  Serial.println("[SIAP] Menunggu perintah controller...");
}

void loop() {
  webSocket.loop();

  stepServo(base, LIMIT_BASE);
  stepServo(shoulder, LIMIT_SHOULDER);
  stepServo(elbow, LIMIT_ELBOW);
  stepServo(gripper, LIMIT_GRIPPER);

  unsigned long now = millis();
  if (now - lastTelemetryMs >= TELEMETRY_INTERVAL) {
    lastTelemetryMs = now;
    sendTelemetry();
  }

  delay(LOOP_DELAY_MS);
}`;
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden mt-6 shadow-xl">
      <div className="bg-zinc-950 px-6 py-4 border-b border-zinc-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-rose-500" />
            <h3 className="text-sm font-semibold tracking-wide text-zinc-100">ESP32 ARDUINO SKETCH CODE</h3>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Instal pustaka <code className="text-rose-400 px-1 py-0.5 bg-zinc-900 rounded">WebSockets</code>, <code className="text-rose-400 px-1 py-0.5 bg-zinc-900 rounded">ArduinoJson</code>, dan <code className="text-rose-400 px-1 py-0.5 bg-zinc-900 rounded">ESP32Servo</code> di Arduino IDE.
          </p>
        </div>

        {/* Connection Mode Selection Tabs */}
        <div className="flex bg-zinc-900 p-1 rounded-lg border border-zinc-800">
          <button
            onClick={() => setActiveTab("secure")}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
              activeTab === "secure"
                ? "bg-rose-500 text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-100"
            }`}
          >
            Cloud (Secure WSS)
          </button>
          <button
            onClick={() => setActiveTab("local")}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
              activeTab === "local"
                ? "bg-rose-500 text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-100"
            }`}
          >
            Lokal / Intranet
          </button>
        </div>
      </div>

      {/* Code Area */}
      <div className="relative">
        <button
          onClick={handleCopy}
          className="absolute top-4 right-4 flex items-center gap-1.5 px-3 py-1.5 bg-zinc-950/70 hover:bg-rose-600/90 border border-zinc-800 hover:border-rose-400 text-xs text-zinc-200 hover:text-white rounded-lg transition-all shadow-md z-10"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span>Tersalin!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Salin Kode</span>
            </>
          )}
        </button>

        <pre className="p-6 text-xs font-mono text-zinc-300 overflow-x-auto max-h-[460px] bg-zinc-950/50">
          <code>{generateCode()}</code>
        </pre>
      </div>

      <div className="bg-zinc-950 px-6 py-4 border-t border-zinc-800 flex flex-col md:flex-row justify-between text-xs text-zinc-500 gap-2">
        <div className="flex items-center gap-1.5">
          <HardDrive className="w-4 h-4 text-emerald-500" />
          <span>Pin default: <strong>PAN_PIN = GPIO 18</strong> | <strong>TILT_PIN = GPIO 19</strong> (ESP32)</span>
        </div>
        <div>
          <span>URL Koneksi: <code>{activeTab === "secure" ? wsUrl : `ws://${localIPPlaceholder}:3000/?role=esp32`}</code></span>
        </div>
      </div>
    </div>
  );
};
