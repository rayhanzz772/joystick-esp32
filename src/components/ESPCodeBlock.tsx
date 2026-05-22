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
  let localIPPlaceholder = "192.168.1.100";
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
 * ESP32 Servo Controller & Joystick Web Client
 * 
 * required Libraries (Download via Arduino Library Manager):
 * 1. "WebSockets" by Markus Sattler
 * 2. "ArduinoJson" by Benoit Blanchon
 * 3. "ESP32Servo" by Kevin Harrington
 */

#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>

// WiFi Configuration
const char* ssid = "NAMA_WIFI_ANDA";
const char* password = "PASSWORD_WIFI_ANDA";

// WebSocket Server Configuration
${
  isWSS
    ? `// Menghubungkan ke Cloud Run (Secure WSS)
const char* ws_host = "${hostStr}";
const int ws_port = ${portStr};
const char* ws_url = "/?role=esp32";`
    : `// Menghubungkan ke Mesin Lokal / ESP32 dalam satu Jaringan (Unsecure WS)
const char* ws_host = "${localIPPlaceholder}"; // Ganti dengan IP komputer Anda
const int ws_port = 3000;
const char* ws_url = "/?role=esp32";`
}

// Servo Pin Constants
const int PAN_PIN = 18;  // Hubungkan ke pin sinyal Servo Pan (Horizontal)
const int TILT_PIN = 19; // Hubungkan ke pin sinyal Servo Tilt (Vertical)
const int LED_PIN = 2;   // Onboard LED ESP32 untuk indikator koneksi

// Servo Objects and Angle Constraints
Servo panServo;
Servo tiltServo;

const int PAN_MIN = ${panMin};
const int PAN_MAX = ${panMax};
const int TILT_MIN = ${tiltMin};
const int TILT_MAX = ${tiltMax};

// Client Instance
WebSocketsClient webSocket;
unsigned long lastTelemetryTime = 0;

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_DISCONNECTED:
      Serial.println("[WS] Terputus!");
      digitalWrite(LED_PIN, LOW); // Matikan indikator LED
      break;
      
    case WStype_CONNECTED:
      Serial.printf("[WS] Terhubung ke: %s\\n", payload);
      digitalWrite(LED_PIN, HIGH); // Nyalakan indikator LED
      break;
      
    case WStype_TEXT:
      {
        // Parsing data JSON yang diterima
        StaticJsonDocument<256> doc;
        DeserializationError error = deserializeJson(doc, payload, length);
        
        if (error) {
          Serial.print(F("Parsing gagal: "));
          Serial.println(error.f_str());
          return;
        }
        
        const char* msgType = doc["type"];
        if (msgType && strcmp(msgType, "control") == 0) {
          int panVal = doc["pan"];
          int tiltVal = doc["tilt"];
          int speed = doc["speed"];
          bool buttonA = doc["buttonA"] | false;
          bool buttonB = doc["buttonB"] | false;
          
          // Batasi sudut servo secara aman
          panVal = constrain(panVal, PAN_MIN, PAN_MAX);
          tiltVal = constrain(tiltVal, TILT_MIN, TILT_MAX);
          
          // Tulis sinyal PWM ke Motor Servo
          panServo.write(panVal);
          tiltServo.write(tiltVal);
          
          Serial.printf("[Servo] Menulis Pan: %d, Tilt: %d | TombolA: %s, TombolB: %s\\n", 
                        panVal, tiltVal, buttonA ? "ON" : "OFF", buttonB ? "ON" : "OFF");
        }
      }
      break;
      
    case WStype_BIN:
      Serial.println("[WS] Menerima data biner");
      break;
      
    case WStype_PING:
      break;
      
    case WStype_PONG:
      break;
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // Alokasi timer PWM untuk ESP32Servo
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  
  // Setup Motor Servo
  panServo.setPeriodHertz(50); // Standar 50Hz servo
  tiltServo.setPeriodHertz(50);
  
  panServo.attach(PAN_PIN, 500, 2400); // Pasangkan Servo dengan pulsa min/max standar
  tiltServo.attach(TILT_PIN, 500, 2400);

  // Set awal ke posisi tengah aman
  panServo.write((PAN_MAX + PAN_MIN) / 2);
  tiltServo.write((TILT_MAX + TILT_MIN) / 2);

  // Menyalakan WiFi
  Serial.printf("\\nMenghubungkan ke %s", ssid);
  WiFi.begin(ssid, password);
  
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  
  Serial.println("");
  Serial.println("WiFi Terhubung!");
  Serial.print("Alamat IP ESP32: ");
  Serial.println(WiFi.localIP());

  // Inisialisasi WebSocket Client
  ${
    isWSS
      ? `// Hubungkan ke Secure WSS Cloud (Menggunakan bypass keamanan SSL)
  webSocket.beginSslWithClient(ws_host, ws_port, ws_url);`
      : `// Hubungkan ke server WebSocket lokal
  webSocket.begin(ws_host, ws_port, ws_url);`
  }

  // Tentukan callback event
  webSocket.onEvent(webSocketEvent);
  
  // Mencoba tersambung kembali otomatis jika terputus
  webSocket.setReconnectInterval(5000);
}

void loop() {
  webSocket.loop();
  
  // Kirim data telemetri berkala setiap 5 detik ke Web Monitor
  unsigned long now = millis();
  if (now - lastTelemetryTime > 5000 && WiFi.status() == WL_CONNECTED) {
    lastTelemetryTime = now;
    
    StaticJsonDocument<200> txDoc;
    txDoc["type"] = "telemetry";
    txDoc["wifiRSSI"] = WiFi.RSSI();
    txDoc["heapFree"] = ESP.getFreeHeap();
    txDoc["uptime"] = now / 1000;
    
    String output;
    serializeJson(txDoc, output);
    webSocket.sendTXT(output);
  }
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
          <span>URL Koneksi: <code>{activeTab === "secure" ? wsUrl : `ws://192.168.1.xxx:3000/?role=esp32`}</code></span>
        </div>
      </div>
    </div>
  );
};
