import React, { useState, useEffect, useRef, useCallback } from "react";
import { ControlState, AppSettings } from "../types";
import { Joystick } from "../components/Joystick";

export default function SimpleJoystickPage() {
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

  const [settings] = useState<AppSettings>({
    panMin: 0,
    panMax: 180,
    tiltMin: 0,
    tiltMax: 180,
    invertX: false,
    invertY: false,
    deadzone: 0.12,
    springMode: true,
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

  const [isConnected, setIsConnected] = useState(false);
  const [sendRate] = useState<number>(50);

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

  useEffect(() => {
    currentControlStateRef.current = controlState;
  }, [controlState]);

  const connectWebSocket = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.close();
    }

    const ws = new WebSocket(`${settings.wsUrl}/?role=web`);
    socketRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "telemetry") {
          // Minimal page: ignore telemetry.
        }
      } catch (err: any) {
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      setTimeout(connectWebSocket, 4000);
    };
  }, [settings.wsUrl]);

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
      return {
        ...prev,
        buttonA: active,
        buttonB: false,
      };
    });
  };

  const panMid = Math.round((settings.panMax + settings.panMin) / 2);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <header className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold">ESP32 4DOF Controller</h1>
          <p className="text-xs text-zinc-500">/joystick - simple mode</p>
        </div>
        <div className={`text-xs font-mono px-2 py-1 rounded border ${isConnected ? "border-emerald-700 text-emerald-400" : "border-rose-800 text-rose-400"}`}>
          {isConnected ? "SOCKET: CONNECTED" : "SOCKET: DISCONNECTED"}
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="flex flex-col items-center gap-4">
            <h2 className="text-xs font-mono text-zinc-400 uppercase">Base + Shoulder</h2>
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

          <div className="flex flex-col items-center gap-4">
            <h2 className="text-xs font-mono text-zinc-400 uppercase">Elbow</h2>
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

        <div className="mt-10 flex items-center justify-center">
          <button
            onClick={handleManualAction}
            className={`px-6 py-3 rounded-lg border text-sm font-mono transition-all ${
              controlState.buttonA
                ? "bg-rose-500/20 border-rose-400 text-rose-300"
                : "bg-zinc-900 border-zinc-800 text-zinc-300"
            }`}
          >
            Gripper: {controlState.buttonA ? "OPEN" : "CLOSE"}
          </button>
        </div>
      </main>
    </div>
  );
}
