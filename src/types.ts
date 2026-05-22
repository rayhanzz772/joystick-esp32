export interface ControlState {
  pan: number;     // Servo Pan angle (0-180)
  tilt: number;    // Servo Tilt angle (0-180)
  speed: number;   // Speed/throttling parameter (0-100)
  buttonA: boolean; // Button A state
  buttonB: boolean; // Button B state
  timestamp: number;
}

export interface TelemetryData {
  wifiRSSI?: number;     // Signal strength
  heapFree?: number;     // ESP32 Free Heap Memory
  uptime?: number;       // Uptime in seconds
  lastPacketId?: number; // Packet ID
  servoCurrentPan?: number;
  servoCurrentTilt?: number;
}

export interface WebLog {
  id: string;
  timestamp: string;
  type: "info" | "warn" | "error" | "tx" | "rx";
  message: string;
}

export interface AppSettings {
  panMin: number;
  panMax: number;
  tiltMin: number;
  tiltMax: number;
  invertX: boolean;
  invertY: boolean;
  deadzone: number; // Gamepad thumbstick deadzone
  springMode: boolean; // Autocenter joystick
  wsUrl: string; // Dynamic websocket url
}
