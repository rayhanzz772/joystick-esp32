import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Activity,
  Clock,
  Cpu,
  List,
  RefreshCw,
  Server,
  Shuffle,
  Sliders,
  Trash2,
  Zap,
  Eye,
  Compass,
} from "lucide-react";
import { ControlState, TelemetryData, WebLog, AppSettings } from "../types";
import { Joystick } from "../components/Joystick";
import { ESPCodeBlock } from "../components/ESPCodeBlock";

export default function FullDashboardPage() {
  const getInitialWsUrl = () => {
    try {
      const isHttps = window.location.protocol === "https:";
      const wsProto = isHttps ? "wss:" : "ws:";
      const currentHost = window.location.host;
      return `${wsProto}//${currentHost}`;
    } catch (e) {
      return "ws://localhost:3000";
    }
  };

  const [settings, setSettings] = useState<AppSettings>({
    panMin: 0,
    panMax: 180,
    tiltMin: 0,
    tiltMax: 180,
    invertX: false,
    invertY: false,
    deadzone: 0.12,
    springMode: false,
    wsUrl: getInitialWsUrl(),
  });

  const [controlState, setControlState] = useState<ControlState>({
    pan: 90,
    tilt: 90,
    elbow: 90,
    speed: 2.0,
    buttonA: false,
    buttonB: false,
    timestamp: Date.now(),
  });

  const [telemetry, setTelemetry] = useState<TelemetryData>({
    wifiRSSI: undefined,
    heapFree: undefined,
    uptime: undefined,
    lastPacketId: 0,
  });

  const [serverStats, setServerStats] = useState({
    webCount: 1,
    esp32Connected: false,
    esp32Count: 0,
  });

  const [isConnected, setIsConnected] = useState(false);
  const [logs, setLogs] = useState<WebLog[]>([]);
  const [connectedGamepad, setConnectedGamepad] = useState<Gamepad | null>(null);
  const [sendRate, setSendRate] = useState<number>(50);
  const [xyHistory, setXyHistory] = useState<Array<{ x: number; y: number }>>([]);
  const [isPatrolling, setIsPatrolling] = useState(false);
  const [patrolSpeed, setPatrolSpeed] = useState<"slow" | "medium" | "fast">("medium");
  const [macroRunning, setMacroRunning] = useState<string>("none");

  const normalizeAxis = (
    value: number,
    min: number,
    max: number,
    invert: boolean
  ) => {
    const mid = (min + max) / 2;
    const range = (max - min) / 2;
    if (range <= 0) return 0;
    let axis = (value - mid) / range;
    axis = Math.max(-1, Math.min(1, axis));
    return invert ? -axis : axis;
  };

  const socketRef = useRef<WebSocket | null>(null);
  const currentControlStateRef = useRef<ControlState>(controlState);
  const settingsRef = useRef<AppSettings>(settings);
  const sendIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const gamepadLoopIdRef = useRef<number | null>(null);

  useEffect(() => {
    currentControlStateRef.current = controlState;
  }, [controlState]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const addLog = useCallback((type: WebLog["type"], message: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [
      { id, timestamp, type, message },
      ...prev.slice(0, 49),
    ]);
  }, []);

  const fetchServerStats = async () => {
    try {
      const response = await fetch("/api/status");
      if (response.ok) {
        const data = await response.json();
        setServerStats({
          webCount: data.webCount || 1,
          esp32Connected: data.esp32Connected || false,
          esp32Count: data.esp32Count || 0,
        });
      }
    } catch (e) {
      // Ignore polling errors
    }
  };

  useEffect(() => {
    fetchServerStats();
    const interval = setInterval(fetchServerStats, 4000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setXyHistory((prev) => {
      const updated = [...prev, { x: controlState.pan, y: controlState.tilt }];
      if (updated.length > 25) {
        updated.shift();
      }
      return updated;
    });
  }, [controlState.pan, controlState.tilt]);

  const connectWebSocket = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.close();
    }

    addLog("info", `Menghubungkan ke WebSocket server: ${settings.wsUrl}`);
    const ws = new WebSocket(`${settings.wsUrl}/?role=web`);
    socketRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      addLog("success" as any, "WebSocket Terhubung! Siap mengontrol.");
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "welcome") {
          addLog("rx", `Welcome ID=${data.clientId} | Role=${data.role}`);
        } else if (data.type === "presence") {
          setServerStats({
            webCount: data.webCount,
            esp32Connected: data.esp32Connected,
            esp32Count: data.esp32Connected ? 1 : 0,
          });
          addLog("info", `Kehadiran berubah: Web Browsers=${data.webCount}, ESP32=${data.esp32Connected ? "ON" : "OFF"}`);
        } else if (data.type === "telemetry") {
          setTelemetry({
            wifiRSSI: data.wifiRSSI,
            heapFree: data.heapFree,
            uptime: data.uptime,
            lastPacketId: (telemetry.lastPacketId || 0) + 1,
            baseAngle: data.baseAngle,
            shldAngle: data.shldAngle,
            elbwAngle: data.elbwAngle,
            grprAngle: data.grprAngle,
          });
          addLog(
            "rx",
            `ESP32 Telemetri: RSSI=${data.wifiRSSI}dBm | Heap=${data.heapFree}B | Servo=${data.baseAngle}/${data.shldAngle}/${data.elbwAngle}/${data.grprAngle}`
          );
        }
      } catch (err: any) {
        addLog("rx", `Menerima pesan non-JSON: ${event.data}`);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      addLog("error", "Koneksi WebSocket Terputus. Menghubungkan ulang dalam 4 detik...");
      setTimeout(connectWebSocket, 4000);
    };

    ws.onerror = () => {
      addLog("error", "Koneksi WebSocket mengalami error!");
    };
  }, [settings.wsUrl, addLog, telemetry.lastPacketId]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [connectWebSocket]);

  useEffect(() => {
    if (sendIntervalRef.current) {
      clearInterval(sendIntervalRef.current);
    }

    sendIntervalRef.current = setInterval(() => {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        const state = currentControlStateRef.current;
        const liveSettings = settingsRef.current;
        const lx = normalizeAxis(state.pan, liveSettings.panMin, liveSettings.panMax, liveSettings.invertX);
        const ly = normalizeAxis(state.tilt, liveSettings.tiltMin, liveSettings.tiltMax, liveSettings.invertY);
        const ry = normalizeAxis(state.elbow, liveSettings.tiltMin, liveSettings.tiltMax, liveSettings.invertY);
        const payload = JSON.stringify({
          type: "control",
          lx,
          ly,
          ry,
          r1: state.buttonA,
          l1: !state.buttonA,
          speed: state.speed,
          timestamp: Date.now(),
        });
        socketRef.current.send(payload);
      }
    }, sendRate);

    return () => {
      if (sendIntervalRef.current) {
        clearInterval(sendIntervalRef.current);
      }
    };
  }, [sendRate]);

  useEffect(() => {
    const handleGamepadConnected = (e: GamepadEvent) => {
      addLog("info", `Gamepad terdeteksi: ${e.gamepad.id} pada index ${e.gamepad.index}`);
      setConnectedGamepad(e.gamepad);
    };

    const handleGamepadDisconnected = (e: GamepadEvent) => {
      addLog("warn", `Gamepad dilepas: ${e.gamepad.id}`);
      setConnectedGamepad(null);
    };

    window.addEventListener("gamepadconnected", handleGamepadConnected);
    window.addEventListener("gamepaddisconnected", handleGamepadDisconnected);

    return () => {
      window.removeEventListener("gamepadconnected", handleGamepadConnected);
      window.removeEventListener("gamepaddisconnected", handleGamepadDisconnected);
    };
  }, [addLog]);

  const pollGamepad = useCallback(() => {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = gamepads[0];

    if (gp) {
      setConnectedGamepad(gp);
      const appSettings = settingsRef.current;

      let axisX = gp.axes[0];
      let axisY = gp.axes[1];
      let axisRY = gp.axes[3] ?? 0;

      if (Math.abs(axisX) < appSettings.deadzone) axisX = 0;
      if (Math.abs(axisY) < appSettings.deadzone) axisY = 0;
      if (Math.abs(axisRY) < appSettings.deadzone) axisRY = 0;

      const panRange = appSettings.panMax - appSettings.panMin;
      const tiltRange = appSettings.tiltMax - appSettings.tiltMin;

      let targetPan = currentControlStateRef.current.pan;
      let targetTilt = currentControlStateRef.current.tilt;
      let targetElbow = currentControlStateRef.current.elbow;

      if (appSettings.springMode) {
        let normalizedX = (axisX + 1) / 2;
        let normalizedY = (axisY + 1) / 2;
        let normalizedRY = (axisRY + 1) / 2;

        if (appSettings.invertX) normalizedX = 1 - normalizedX;
        if (appSettings.invertY) normalizedY = 1 - normalizedY;
        if (appSettings.invertY) normalizedRY = 1 - normalizedRY;

        targetPan = Math.round(appSettings.panMin + normalizedX * panRange);
        targetTilt = Math.round(appSettings.tiltMin + normalizedY * tiltRange);
        targetElbow = Math.round(appSettings.tiltMin + normalizedRY * tiltRange);
      } else {
        const incrementSpeed = 1.8;
        const dx = axisX * incrementSpeed * (appSettings.invertX ? -1 : 1);
        const dy = axisY * incrementSpeed * (appSettings.invertY ? -1 : 1);
        const dry = axisRY * incrementSpeed * (appSettings.invertY ? -1 : 1);

        targetPan = Math.max(appSettings.panMin, Math.min(appSettings.panMax, Math.round(targetPan + dx)));
        targetTilt = Math.max(appSettings.tiltMin, Math.min(appSettings.tiltMax, Math.round(targetTilt + dy)));
        targetElbow = Math.max(appSettings.tiltMin, Math.min(appSettings.tiltMax, Math.round(targetElbow + dry)));
      }

      const btnAState = gp.buttons[0]?.pressed || false;

      if (
        targetPan !== currentControlStateRef.current.pan ||
        targetTilt !== currentControlStateRef.current.tilt ||
        targetElbow !== currentControlStateRef.current.elbow ||
        btnAState !== currentControlStateRef.current.buttonA
      ) {
        setControlState((prev) => ({
          ...prev,
          pan: targetPan,
          tilt: targetTilt,
          elbow: targetElbow,
          buttonA: btnAState,
          timestamp: Date.now(),
        }));
      }
    } else if (connectedGamepad) {
      setConnectedGamepad(null);
    }

    gamepadLoopIdRef.current = requestAnimationFrame(pollGamepad);
  }, [connectedGamepad]);

  useEffect(() => {
    gamepadLoopIdRef.current = requestAnimationFrame(pollGamepad);
    return () => {
      if (gamepadLoopIdRef.current) {
        cancelAnimationFrame(gamepadLoopIdRef.current);
      }
    };
  }, [pollGamepad]);

  const handleJoystickChange = (newPan: number, newTilt: number) => {
    setControlState((prev) => ({
      ...prev,
      pan: newPan,
      tilt: newTilt,
      timestamp: Date.now(),
    }));
  };

  const handleElbowChange = (newElbow: number) => {
    setControlState((prev) => ({
      ...prev,
      elbow: newElbow,
      timestamp: Date.now(),
    }));
  };

  const handleManualAction = () => {
    setControlState((prev) => {
      const active = !prev.buttonA;
      addLog("info", `Gripper ${active ? "OPEN" : "CLOSE"}: ${active ? "AKTIF" : "NONAKTIF"}`);
      return {
        ...prev,
        buttonA: active,
        buttonB: false,
      };
    });
  };

  const clearLogs = () => {
    setLogs([]);
    addLog("info", "Log antarmuka dibersihkan.");
  };

  useEffect(() => {
    if (!isPatrolling) return;

    let step = patrolSpeed === "slow" ? 2 : patrolSpeed === "medium" ? 5 : 9;
    let direction = 1;

    const intervalMs = 60;
    const patrolTimer = setInterval(() => {
      setControlState((prev) => {
        let currentPan = prev.pan;
        let nextPan = currentPan + (direction * step);

        if (nextPan >= settings.panMax) {
          nextPan = settings.panMax;
          direction = -1;
        } else if (nextPan <= settings.panMin) {
          nextPan = settings.panMin;
          direction = 1;
        }

        return {
          ...prev,
          pan: nextPan,
          timestamp: Date.now(),
        };
      });
    }, intervalMs);

    return () => clearInterval(patrolTimer);
  }, [isPatrolling, patrolSpeed, settings.panMin, settings.panMax]);

  const runWiggleMacro = () => {
    if (macroRunning !== "none") return;
    setIsPatrolling(false);
    setMacroRunning("horizontal-snake");
    addLog("info", "Menjalankan makro: Wiggle/Wag horizontal test");

    const pMid = Math.round((settings.panMax + settings.panMin) / 2);
    const originTilt = currentControlStateRef.current.tilt;
    const steps = [
      { pan: Math.max(settings.panMin, pMid - 40), tilt: originTilt },
      { pan: Math.min(settings.panMax, pMid + 40), tilt: originTilt },
      { pan: Math.max(settings.panMin, pMid - 40), tilt: originTilt },
      { pan: Math.min(settings.panMax, pMid + 40), tilt: originTilt },
      { pan: Math.max(settings.panMin, pMid - 40), tilt: originTilt },
      { pan: Math.min(settings.panMax, pMid + 40), tilt: originTilt },
      { pan: pMid, tilt: originTilt },
    ];

    steps.forEach((target, i) => {
      setTimeout(() => {
        setControlState((prev) => ({
          ...prev,
          pan: target.pan,
          tilt: target.tilt,
          timestamp: Date.now(),
        }));
        if (i === steps.length - 1) {
          setMacroRunning("none");
          addLog("info", "Makro Wiggle selesai!");
        }
      }, (i + 1) * 200);
    });
  };

  const runNodMacro = () => {
    if (macroRunning !== "none") return;
    setIsPatrolling(false);
    setMacroRunning("vertical-nod");
    addLog("info", "Menjalankan makro: Nodding vertical test");

    const tMid = Math.round((settings.tiltMax + settings.tiltMin) / 2);
    const originPan = currentControlStateRef.current.pan;
    const steps = [
      { pan: originPan, tilt: Math.max(settings.tiltMin, tMid - 30) },
      { pan: originPan, tilt: Math.min(settings.tiltMax, tMid + 30) },
      { pan: originPan, tilt: Math.max(settings.tiltMin, tMid - 30) },
      { pan: originPan, tilt: Math.min(settings.tiltMax, tMid + 30) },
      { pan: originPan, tilt: tMid },
    ];

    steps.forEach((target, i) => {
      setTimeout(() => {
        setControlState((prev) => ({
          ...prev,
          pan: target.pan,
          tilt: target.tilt,
          timestamp: Date.now(),
        }));
        if (i === steps.length - 1) {
          setMacroRunning("none");
          addLog("info", "Makro Nodding selesai!");
        }
      }, (i + 1) * 250);
    });
  };

  const runCircleMacro = () => {
    if (macroRunning !== "none") return;
    setIsPatrolling(false);
    setMacroRunning("circular-scan");
    addLog("info", "Menjalankan makro: Orbit Circle Map test");

    const pMid = Math.round((settings.panMax + settings.panMin) / 2);
    const tMid = Math.round((settings.tiltMax + settings.tiltMin) / 2);
    const radius = 35;

    const steps: Array<{ pan: number; tilt: number }> = [];
    for (let angle = 0; angle <= 360; angle += 45) {
      const radians = (angle * Math.PI) / 180;
      const targetPan = Math.max(settings.panMin, Math.min(settings.panMax, Math.round(pMid + Math.cos(radians) * radius)));
      const targetTilt = Math.max(settings.tiltMin, Math.min(settings.tiltMax, Math.round(tMid + Math.sin(radians) * radius)));
      steps.push({ pan: targetPan, tilt: targetTilt });
    }
    steps.push({ pan: pMid, tilt: tMid });

    steps.forEach((target, i) => {
      setTimeout(() => {
        setControlState((prev) => ({
          ...prev,
          pan: target.pan,
          tilt: target.tilt,
          timestamp: Date.now(),
        }));
        if (i === steps.length - 1) {
          setMacroRunning("none");
          addLog("info", "Makro Circular Scan selesai!");
        }
      }, (i + 1) * 150);
    });
  };

  const triggerCenterCalibration = () => {
    const pMid = Math.round((settings.panMax + settings.panMin) / 2);
    const tMid = Math.round((settings.tiltMax + settings.tiltMin) / 2);
    setControlState((prev) => ({
      ...prev,
      pan: pMid,
      tilt: tMid,
    }));
    addLog("info", `Kalibrasi: Servo diselaraskan ke tengah (${pMid}°, ${tMid}°)`);
  };

  const panMid = Math.round((settings.panMax + settings.panMin) / 2);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col grid-bg pb-12">
      <header className="bg-zinc-900/90 border-b border-zinc-800 backdrop-blur-md sticky top-0 z-50 px-6 py-4 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-rose-500 to-amber-500 flex items-center justify-center shadow-lg shadow-rose-950/20">
            <Sliders className="w-5 h-5 text-white animate-pulse" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
              ESP32 Servo Joystick Hub
              <span className="text-[10px] bg-zinc-800 text-zinc-400 font-mono font-medium px-2 py-0.5 rounded border border-zinc-700/60 font-semibold uppercase">Real-Time Control</span>
            </h1>
            <p className="text-xs text-zinc-400">WebSocket Gamepad Interface & telemetry monitor</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-mono font-medium ${
            isConnected
              ? "bg-emerald-950/30 border-emerald-800 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.1)]"
              : "bg-rose-950/30 border-rose-900 text-rose-400"
          }`}>
            <span className={`w-2.5 h-2.5 rounded-full inline-block ${isConnected ? "bg-emerald-400 animate-pulse" : "bg-rose-500"}`} />
            <span>SOCKET: {isConnected ? "CONNECTED" : "DISCONNECTED"}</span>
          </div>

          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-mono font-medium ${
            serverStats.esp32Connected
              ? "bg-rose-950/30 border-rose-800 text-rose-400 shadow-[0_0_12px_rgba(244,63,94,0.15)]"
              : "bg-zinc-900 border-zinc-800 text-zinc-500"
          }`}>
            <Cpu className={`w-4 h-4 ${serverStats.esp32Connected ? "text-rose-400" : "text-zinc-600"}`} />
            <span>ESP32: {serverStats.esp32Connected ? "ACTIVE" : "OFFLINE"}</span>
          </div>

          <div className="flex items-center gap-1 text-[11px] font-mono text-zinc-500 bg-zinc-900 border border-zinc-800 px-2 py-1.5 rounded-md">
            <Server className="w-3.5 h-3.5" />
            <span>Web Users: {serverStats.webCount}</span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start flex-grow">
        <div className="lg:col-span-4 flex flex-col gap-6 h-full">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-xl flex flex-col justify-between">
            <div className="flex justify-between items-center border-b border-zinc-850 pb-3">
              <span className="text-xs font-bold tracking-wider font-mono text-zinc-400 uppercase flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-rose-500" />
                ESP32 Telemetry
              </span>
              <span className="text-[10px] font-mono font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">
                Live Feed
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-850">
                <span className="text-[10px] text-zinc-500 font-bold block mb-1">RSSI SIGNAL</span>
                <div className="flex items-end gap-1.5">
                  <span className="text-sm font-semibold font-mono tracking-wide">
                    {telemetry.wifiRSSI !== undefined ? `${telemetry.wifiRSSI} dBm` : "---"}
                  </span>
                </div>
                <div className="w-full bg-zinc-900 h-1.5 rounded-full mt-2 overflow-hidden">
                  <div
                    className={`h-full ${
                      telemetry.wifiRSSI && telemetry.wifiRSSI > -60 ? "bg-emerald-500" : telemetry.wifiRSSI && telemetry.wifiRSSI > -80 ? "bg-amber-500" : "bg-rose-500"
                    }`}
                    style={{ width: telemetry.wifiRSSI ? `${Math.max(0, Math.min(100, (telemetry.wifiRSSI + 100) * 1.5))}%` : "0%" }}
                  />
                </div>
              </div>

              <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-850">
                <span className="text-[10px] text-zinc-500 font-bold block mb-1">FREE MEMORY</span>
                <span className="text-sm font-semibold font-mono text-zinc-200 block">
                  {telemetry.heapFree !== undefined ? `${Math.round(telemetry.heapFree / 1024)} KB` : "--- KB"}
                </span>
                <span className="text-[9px] font-mono text-zinc-600 block mt-1">Free Heap Bytes</span>
              </div>

              <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-850 col-span-2 flex justify-between items-center">
                <div>
                  <span className="text-[10px] text-zinc-500 font-bold block">SYSTEM UPTIME</span>
                  <span className="text-sm font-semibold font-mono text-white mt-1 block">
                    {telemetry.uptime !== undefined ? (
                      `Uptime: ${Math.floor(telemetry.uptime / 60)}m ${telemetry.uptime % 60}s`
                    ) : (
                      "0h 0m 0s"
                    )}
                  </span>
                </div>
                <div className="h-8 w-8 rounded bg-zinc-900 border border-zinc-850 flex items-center justify-center">
                  <Clock className="w-4 h-4 text-rose-500 animate-[spin_5s_linear_infinite]" />
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-zinc-850 text-[10px] text-zinc-500 flex justify-between tracking-wide font-mono">
              <span>PACKET INDEX: {telemetry.lastPacketId}</span>
              <span>ROLE: CONTROLLER_GUI</span>
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-xl flex-grow flex flex-col min-h-[300px]">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xs font-bold tracking-wider font-mono text-zinc-400 uppercase flex items-center gap-1.5">
                <List className="w-4 h-4 text-rose-500" />
                Live WebSocket Traffic
              </h3>
              <button
                onClick={clearLogs}
                className="text-[10px] text-zinc-500 hover:text-rose-400 font-mono flex items-center gap-1 transition-all"
                title="Hapus log list"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear
              </button>
            </div>

            <div className="bg-zinc-950 rounded-lg p-3.5 flex-grow border border-zinc-850 font-mono text-[10px] overflow-y-auto max-h-[540px] space-y-2 select-text">
              {logs.length > 0 ? (
                logs.map((log) => {
                  let colorClass = "text-zinc-400";
                  if (log.type === "tx") colorClass = "text-amber-400 font-bold";
                  if (log.type === "rx") colorClass = "text-emerald-400";
                  if (log.type === "error") colorClass = "text-red-400 font-bold";
                  if (log.type === "warn") colorClass = "text-orange-300";

                  return (
                    <div key={log.id} className="flex items-start gap-1.5 border-b border-zinc-900/60 pb-1 leading-normal">
                      <span className="text-zinc-600 shrink-0 select-none">[{log.timestamp}]</span>
                      <span className={`font-bold uppercase shrink-0 select-none text-[9px] ${
                        log.type === "tx" ? "text-amber-500" : log.type === "rx" ? "text-emerald-500" : "text-blue-400"
                      }`}>
                        {log.type === "tx" ? "TX ➔" : log.type === "rx" ? "◀ RX" : "SYS"}
                      </span>
                      <span className={`break-all ${colorClass}`}>{log.message}</span>
                    </div>
                  );
                })
              ) : (
                <div className="h-full flex items-center justify-center text-zinc-600 italic py-16 text-center">
                  Tidak ada transaksi sinyal websocket.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-8 bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-xl flex flex-col items-center">
          <div className="w-full border-b border-zinc-800 pb-4 mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
            <div>
              <h2 className="text-sm font-bold tracking-wider font-mono text-rose-500 uppercase">JOYSTICK GUI CONTROL CENTER</h2>
              <p className="text-[11px] text-zinc-400 mt-0.5">Drag visual knob atau gerakkan physical joystick untuk menyetir Servo</p>
            </div>

            <button
              onClick={triggerCenterCalibration}
              className="px-2.5 py-1 text-[10px] font-mono border border-rose-500/30 hover:border-rose-400 text-rose-400 hover:text-white bg-rose-500/5 hover:bg-rose-500/10 rounded-md transition-all shrink-0"
            >
              Align Center
            </button>
          </div>

          <div className="w-full relative h-28 bg-zinc-950 border border-zinc-850 rounded-xl mb-6 flex items-center justify-center overflow-hidden">
            <div className="absolute inset-0 bg-radial from-rose-950/5 to-zinc-950" />
            <div className="absolute left-1/2 w-[1px] h-full bg-zinc-900/60" />
            <div className="absolute top-1/2 h-[1px] w-full bg-zinc-900/60" />

            <svg className="absolute inset-0 w-full h-full">
              <path
                d={xyHistory.map((point, index) => {
                  return `${index === 0 ? "M" : "L"} ${point.x * 1} ${112 - point.y / 1.6}`;
                }).join(" ")}
                fill="none"
                stroke="rgba(244, 63, 94, 0.45)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="transition-all duration-75"
              />
              {xyHistory.length > 0 && (
                <circle
                  cx={xyHistory[xyHistory.length - 1].x * 1}
                  cy={112 - xyHistory[xyHistory.length - 1].y / 1.6}
                  r="4"
                  fill="#f43f5e"
                  className="animate-ping"
                />
              )}
            </svg>
            <div className="absolute top-2 left-3 text-[9px] font-mono tracking-widest text-rose-500 font-bold uppercase">TRAJECTORY SCOPE FEED</div>
            <div className="absolute bottom-2 right-3 text-[9px] font-mono text-zinc-500">HISTORY STACK: {xyHistory.length}/25</div>
          </div>

          <div className="my-8 w-full select-none">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex flex-col items-center gap-3 w-full">
                <Joystick
                  pan={controlState.pan}
                  tilt={controlState.tilt}
                  settings={settings}
                  lockAxis="none"
                  sizeClass="w-64 h-64"
                  knobClass="w-16 h-16 md:w-20 md:h-20"
                  knobInnerClass="w-10 h-10 md:w-12 md:h-12"
                  onChange={handleJoystickChange}
                />
              </div>

              <div className="flex flex-col items-center gap-3 w-full">
                <Joystick
                  pan={panMid}
                  tilt={controlState.elbow}
                  settings={settings}
                  lockAxis="pan"
                  sizeClass="w-64 h-64"
                  knobClass="w-16 h-16 md:w-20 md:h-20"
                  knobInnerClass="w-10 h-10 md:w-12 md:h-12"
                  onChange={(_, newTilt) => handleElbowChange(newTilt)}
                />
              </div>
            </div>
          </div>

          <div className="w-full border-t border-zinc-800 pt-6 mt-6">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h4 className="text-xs font-bold tracking-wider font-mono text-zinc-400 uppercase flex items-center gap-1.5">
                  <Compass className="w-4 h-4 text-rose-500 animate-[spin_10s_linear_infinite]" />
                  AUTOPILOT & MOTION MACROS
                </h4>
                <p className="text-[10px] text-zinc-500">Memicu rentetan gerakan terencana secara otomatis ke motor servo</p>
              </div>

              {isPatrolling && (
                <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-850">
                  {(["slow", "medium", "fast"] as const).map((speed) => (
                    <button
                      key={speed}
                      onClick={() => setPatrolSpeed(speed)}
                      className={`px-1.5 py-0.5 text-[8px] font-mono rounded select-none transition-all uppercase ${
                        patrolSpeed === speed
                          ? "bg-rose-500 text-white font-bold"
                          : "text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      {speed}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <button
                onClick={() => {
                  setIsPatrolling(!isPatrolling);
                  addLog("info", !isPatrolling ? "Mode Autopilot Patrol DIAKTIFKAN" : "Mode Autopilot Patrol DINONAKTIFKAN");
                }}
                className={`py-2 px-3 rounded-xl border flex items-center gap-2 text-left justify-start transition-all shadow-sm group ${
                  isPatrolling
                    ? "bg-rose-500/10 border-rose-400 text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.1)]"
                    : "bg-zinc-950 border-zinc-850 text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200"
                }`}
              >
                <div className={`p-1.5 rounded-lg ${isPatrolling ? "bg-rose-500 text-white animate-spin" : "bg-zinc-900 text-zinc-500 group-hover:text-rose-400"}`}>
                  <RefreshCw className="w-3.5 h-3.5" />
                </div>
                <div>
                  <span className="text-[10px] font-bold block leading-none">AUTO SWEEP</span>
                  <span className="text-[9px] text-zinc-550 block font-mono mt-0.5 uppercase">
                    {isPatrolling ? "ACTIVE (PAN)" : "PATROL OFF"}
                  </span>
                </div>
              </button>

              <button
                onClick={runWiggleMacro}
                disabled={macroRunning !== "none"}
                className={`py-2 px-3 rounded-xl border flex items-center gap-2 text-left justify-start transition-all shadow-sm group ${
                  macroRunning === "horizontal-snake"
                    ? "bg-amber-500/10 border-amber-500 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.1)] animate-pulse"
                    : "bg-zinc-950 border-zinc-850 text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200 disabled:opacity-50"
                }`}
              >
                <div className={`p-1.5 rounded-lg ${macroRunning === "horizontal-snake" ? "bg-amber-500 text-zinc-950" : "bg-zinc-900 text-zinc-500 group-hover:text-amber-400"}`}>
                  <Shuffle className="w-3.5 h-3.5" />
                </div>
                <div>
                  <span className="text-[10px] font-bold block leading-none">WIGGLE WAG</span>
                  <span className="text-[9px] text-zinc-550 block font-mono mt-0.5 uppercase">
                    {macroRunning === "horizontal-snake" ? "RUNNING" : "WAVE TEST"}
                  </span>
                </div>
              </button>

              <button
                onClick={runNodMacro}
                disabled={macroRunning !== "none"}
                className={`py-2 px-3 rounded-xl border flex items-center gap-2 text-left justify-start transition-all shadow-sm group ${
                  macroRunning === "vertical-nod"
                    ? "bg-purple-500/10 border-purple-500 text-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.1)] animate-pulse"
                    : "bg-zinc-950 border-zinc-850 text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200 disabled:opacity-50"
                }`}
              >
                <div className={`p-1.5 rounded-lg ${macroRunning === "vertical-nod" ? "bg-purple-500 text-white" : "bg-zinc-900 text-zinc-500 group-hover:text-purple-400"}`}>
                  <Zap className="w-3.5 h-3.5" />
                </div>
                <div>
                  <span className="text-[10px] font-bold block leading-none">NODDING YES</span>
                  <span className="text-[9px] text-zinc-550 block font-mono mt-0.5 uppercase">
                    {macroRunning === "vertical-nod" ? "RUNNING" : "VERT TILT"}
                  </span>
                </div>
              </button>

              <button
                onClick={runCircleMacro}
                disabled={macroRunning !== "none"}
                className={`py-2 px-3 rounded-xl border flex items-center gap-2 text-left justify-start transition-all shadow-sm group ${
                  macroRunning === "circular-scan"
                    ? "bg-blue-500/10 border-blue-500 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.1)] animate-pulse"
                    : "bg-zinc-950 border-zinc-850 text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200 disabled:opacity-50"
                }`}
              >
                <div className={`p-1.5 rounded-lg ${macroRunning === "circular-scan" ? "bg-blue-500 text-white" : "bg-zinc-900 text-zinc-500 group-hover:text-blue-400"}`}>
                  <Eye className="w-3.5 h-3.5" />
                </div>
                <div>
                  <span className="text-[10px] font-bold block leading-none">ORBIT SCAN</span>
                  <span className="text-[9px] text-zinc-550 block font-mono mt-0.5 uppercase">
                    {macroRunning === "circular-scan" ? "RUNNING" : "CIRCLE MAP"}
                  </span>
                </div>
              </button>
            </div>
          </div>

          <div className="w-full border-t border-zinc-800 pt-6 mt-8">
            <h4 className="text-xs font-bold tracking-wider font-mono text-zinc-400 uppercase mb-3">GRIPPER CONTROL (TOGGLE)</h4>
            <div className="grid grid-cols-1 gap-4">
              <button
                onClick={handleManualAction}
                className={`py-3.5 px-4 rounded-xl border flex flex-col items-center justify-center transition-all shadow-md ${
                  controlState.buttonA
                    ? "bg-rose-500/20 border-rose-400 text-white shadow-[0_0_15px_rgba(244,63,94,0.2)]"
                    : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <span className="text-[10px] font-bold font-mono tracking-widest block uppercase">GRIPPER TOGGLE</span>
                <span className={`text-sm font-black font-mono mt-1 ${controlState.buttonA ? "text-rose-400 scale-105" : "text-zinc-500"}`}>
                  {controlState.buttonA ? "OPEN / ON" : "CLOSE / OFF"}
                </span>
                <span className="text-[9px] text-zinc-650 font-mono mt-1 select-none">(Klik untuk toggle)</span>
              </button>
            </div>
          </div>
        </div>
      </main>

      <footer className="max-w-7xl w-full mx-auto px-4 md:px-6">
        <ESPCodeBlock
          wsUrl={settings.wsUrl}
          panMin={settings.panMin}
          panMax={settings.panMax}
          tiltMin={settings.tiltMin}
          tiltMax={settings.tiltMax}
        />

        <div className="mt-8 flex justify-between text-[11px] text-zinc-600 font-mono tracking-wide">
          <span>ESP32 WS SERVO CONTROLLER PAN-TILT SYSTEM</span>
          <span>© 2026 CENTRAL SYSTEMS HUB</span>
        </div>
      </footer>
    </div>
  );
}
