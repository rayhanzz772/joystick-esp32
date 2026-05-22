import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { parse } from "url";

// Custom type representing connected client metadata
interface ClientInfo {
  id: string;
  socket: WebSocket;
  role: "web" | "esp32";
  connectedAt: Date;
  ip: string;
}

// Global active client set
const clients = new Map<string, ClientInfo>();

// Keep track of the last known controller state as a cache
let lastControlState = {
  pan: 90, // X axis servo (0 to 180, default 90 centered)
  tilt: 90, // Y axis servo (0 to 180, default 90 centered)
  speed: 0, // motor speed, accessory parameter
  buttonA: false,
  buttonB: false,
  timestamp: Date.now(),
};

// Simple log buffer for viewing via API if needed
const logBuffer: Array<{ timestamp: string; level: string; msg: string }> = [];
function logEvent(level: string, msg: string) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}] ${msg}`);
  logBuffer.push({ timestamp, level, msg });
  if (logBuffer.length > 100) {
    logBuffer.shift(); // keep it clean
  }
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const PORT = 3000;

  app.use(express.json());

  // CORS middleware for standard REST endpoints
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
    } else {
      next();
    }
  });

  // REST endpoints for configuration guidelines or debugging UI status
  app.get("/api/status", (req, res) => {
    const webClients = Array.from(clients.values()).filter((c) => c.role === "web");
    const esp32Clients = Array.from(clients.values()).filter((c) => c.role === "esp32");

    res.json({
      webCount: webClients.length,
      esp32Connected: esp32Clients.length > 0,
      esp32Count: esp32Clients.length,
      lastState: lastControlState,
      serverTime: new Date().toISOString(),
      activeClients: Array.from(clients.values()).map((c) => ({
        id: c.id,
        role: c.role,
        connectedAt: c.connectedAt,
        ip: c.ip,
      })),
    });
  });

  app.get("/api/logs", (req, res) => {
    res.json(logBuffer);
  });

  // Attach WebSocket Server
  const wss = new WebSocketServer({ noServer: true });

  // Function to broadcast event to a specific audience or everyone
  const broadcast = (data: any, excludeId?: string, targetRole?: "web" | "esp32") => {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    clients.forEach((client, id) => {
      if (id === excludeId) return;
      if (targetRole && client.role !== targetRole) return;
      if (client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(payload);
      }
    });
  };

  const getPresenceUpdate = () => {
    const webCount = Array.from(clients.values()).filter((c) => c.role === "web").length;
    const esp32Connected = Array.from(clients.values()).some((c) => c.role === "esp32");
    return {
      type: "presence",
      webCount,
      esp32Connected,
      timestamp: Date.now(),
    };
  };

  wss.on("connection", (socket: WebSocket, req) => {
    const parsedUrl = parse(req.url || "", true);
    // Role can be provided as ?role=esp32 or ?role=web
    const requestedRole = parsedUrl.query.role;
    const role: "web" | "esp32" = requestedRole === "esp32" ? "esp32" : "web";
    const clientId = Math.random().toString(36).substring(2, 9);
    const ip = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "unknown";

    const clientInfo: ClientInfo = {
      id: clientId,
      socket,
      role,
      connectedAt: new Date(),
      ip,
    };

    clients.set(clientId, clientInfo);
    logEvent("INFO", `Client joined: ID=${clientId}, Role=${role}, IP=${ip}`);

    // Immediately send initialization data to the connection
    socket.send(
      JSON.stringify({
        type: "welcome",
        clientId,
        role,
        lastControlState,
        msg: `Connected successfully to central WebSocket server as ${role}`,
      })
    );

    // Notify all clients of updated presence
    broadcast(getPresenceUpdate());

    // Message handler
    socket.on("message", (message) => {
      try {
        const rawString = message.toString();
        let parsed: any;
        try {
          parsed = JSON.parse(rawString);
        } catch {
          // If not valid JSON, treat as raw message (relevant for quick custom format ESP32 messages)
          logEvent("DEBUG", `Raw string message: "${rawString}"`);
          return;
        }

        // Handle based on Message Type or Sender Role
        if (role === "web") {
          // Web client controls
          if (parsed.type === "control") {
            lastControlState = {
              pan: isNaN(parsed.pan) ? 90 : parsed.pan,
              tilt: isNaN(parsed.tilt) ? 90 : parsed.tilt,
              speed: isNaN(parsed.speed) ? 0 : parsed.speed,
              buttonA: !!parsed.buttonA,
              buttonB: !!parsed.buttonB,
              timestamp: Date.now(),
            };

            // Forward directly to ESP32 clients
            broadcast(
              {
                type: "control",
                ...lastControlState,
              },
              clientId,
              "esp32"
            );
          } else {
            // General event, fallback to broadcasting to all except sender
            broadcast(parsed, clientId);
          }
        } else if (role === "esp32") {
          // ESP32 telemetry/logs
          if (parsed.type === "telemetry" || parsed.type === "log") {
            // Relay ESP32 telemetry directly to web clients
            broadcast(parsed, clientId, "web");
          } else {
            // Fallback: relay everything from ESP32 to web clients for monitoring
            broadcast(parsed, clientId, "web");
          }
        }
      } catch (err: any) {
        logEvent("ERROR", `Error handling socket message: ${err.message}`);
      }
    });

    socket.on("close", () => {
      clients.delete(clientId);
      logEvent("INFO", `Client disconnected: ID=${clientId} (Role=${role})`);
      broadcast(getPresenceUpdate());
    });

    socket.on("error", (err) => {
      logEvent("ERROR", `Socket error on client ${clientId}: ${err.message}`);
      clients.delete(clientId);
      broadcast(getPresenceUpdate());
    });
  });

  // Handle server upgrade for WebSocket connection on port 3000
  server.on("upgrade", (req, socket, head) => {
    const parsedUrl = parse(req.url || "", true);
    // Match root websocket upgrades or /ws endpoint
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  // Vite middleware setup (Express middleware mode in dev, static build service in prod)
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    logEvent("INFO", "Initialized Vite Middleware in DEV mode.");
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    logEvent("INFO", "Serving compiled static site in PRODUCTION mode.");
  }

  server.listen(PORT, "0.0.0.0", () => {
    logEvent("INFO", `Central WebSocket + HTTP server started on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Critical server startup crash:", err);
});
