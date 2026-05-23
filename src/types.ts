export interface ControlState {
  pan: number; // Base axis angle (0-180)
  tilt: number; // Shoulder axis angle (0-180)
  elbow: number; // Elbow axis angle (0-180)
  speed: number; // Motion speed scalar (0.5-10.0)
  buttonA: boolean; // R1: open gripper
  buttonB: boolean; // L1: close gripper
  timestamp: number;
}

export interface TelemetryData {
  wifiRSSI?: number;     // Signal strength
  heapFree?: number;     // ESP32 Free Heap Memory
  uptime?: number;       // Uptime in seconds
  lastPacketId?: number; // Packet ID
  baseAngle?: number;
  shldAngle?: number;
  elbwAngle?: number;
  grprAngle?: number;
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
