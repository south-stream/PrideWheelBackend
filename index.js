// In-memory log buffer for real-time log viewing
const LOG_BUFFER_SIZE = 500;
const logBuffer = [];
const logClients = new Set(); // For SSE clients

function pushLog(line) {
  logBuffer.push(line);
  if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();
  // Send to all SSE clients
  // Escape any problematic characters for SSE/HTML
  function escapeForSSE(str) {
    return String(str)
      .replace(/\\/g, "\\\\")
      .replace(/\r/g, "")
      .replace(/\u2028|\u2029/g, "") // Remove line/paragraph separators
      .replace(/\u0000/g, ""); // Remove null bytes
  }
  for (const res of logClients) {
    try {
      res.write(`data: ${escapeForSSE(line)}\n\n`, "utf8");
      if (typeof res.flushHeaders === "function") res.flushHeaders();
    } catch (e) {}
  }
}

// Patch console.log to also push to logBuffer
const origLog = console.log;
console.log = (...args) => {
  const line = args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ");
  pushLog(line);
  origLog.apply(console, args);
};
const WebSocket = require("ws");
const http = require("http");
const https = require("https");
const url = require("url");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

// Environment detection
const isProduction = process.env.NODE_ENV === "production";
const isVercel = process.env.VERCEL === "1";

// Store game rooms and clients
const gameRooms = new Map();
const clients = new Map();

// CORS configuration
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",")
    : "*",
  credentials: true,
};

// Cleanup function for old rooms
function cleanupRooms() {
  const now = Date.now();
  for (const [roomId, room] of gameRooms.entries()) {
    if (now - room.lastActivity > 300000) {
      // 5 minutes
      console.log(`Cleaning up inactive room: ${roomId}`);
      gameRooms.delete(roomId);
    }
  }
}

// Run cleanup every minute
setInterval(cleanupRooms, 60000);

// WebSocket connection handler
function handleWebSocketConnection(ws, req) {
  const clientId = Math.random().toString(36).substring(2, 9);
  console.log(`New WebSocket connection: ${clientId}`);

  // Store client connection
  clients.set(clientId, {
    ws,
    roomId: null,
    clientType: null,
    lastPing: Date.now(),
  });

  // Send welcome message
  ws.send(
    JSON.stringify({
      type: "connected",
      clientId: clientId,
      timestamp: Date.now(),
    })
  );

  // Handle incoming messages
  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data.toString());
      handleMessage(clientId, message);
    } catch (error) {
      console.error("Error parsing message:", error);
    }
  });

  // Handle connection close
  ws.on("close", () => {
    console.log(`Client disconnected: ${clientId}`);
    const client = clients.get(clientId);
    if (client?.roomId) {
      leaveRoom(clientId, client.roomId);
    }
    clients.delete(clientId);
  });

  // Handle errors
  ws.on("error", (error) => {
    console.error(`WebSocket error for client ${clientId}:`, error);
  });

  // Ping/pong for connection health
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    } else {
      clearInterval(pingInterval);
    }
  }, 30000);

  ws.on("pong", () => {
    const client = clients.get(clientId);
    if (client) {
      client.lastPing = Date.now();
    }
  });
}

function handleMessage(clientId, message) {
  const client = clients.get(clientId);
  if (!client) return;

  // Log all incoming messages with roomId, timestamp, and message
  const now = new Date().toISOString();
  const roomId = message.roomId || (client && client.roomId) || "-";
  console.log(
    `[IN] [${now}] [room:${roomId}] from client:${clientId} ->`,
    JSON.stringify(message)
  );

  switch (message.type) {
    case "join":
      joinRoom(clientId, message.roomId, message.clientType);
      break;

    case "handshake":
      // Handle handshake messages (same as join)
      joinRoom(clientId, message.roomId, message.clientType);
      break;

    case "gameState":
      updateGameState(clientId, message.roomId, message.data);
      break;

    case "command":
      broadcastCommand(clientId, message.roomId, message.data);
      break;

    case "ping":
      // Respond to ping
      client.ws.send(
        JSON.stringify({
          type: "pong",
          timestamp: Date.now(),
        })
      );
      break;
  }
}

function joinRoom(clientId, roomId, clientType) {
  const client = clients.get(clientId);
  if (!client) return;

  // Leave current room if any
  if (client.roomId) {
    leaveRoom(clientId, client.roomId);
  }

  // Create room if it doesn't exist
  if (!gameRooms.has(roomId)) {
    gameRooms.set(roomId, {
      clients: new Set(),
      gameState: {
        isSpinning: false,
        isDecelerating: false,
        winner: null,
        categories: [],
        numSlices: 12,
        lastUpdate: Date.now(),
      },
      lastActivity: Date.now(),
    });
    console.log(`Created new room: ${roomId}`);
  }

  // Join room
  const room = gameRooms.get(roomId);
  room.clients.add(clientId);
  room.lastActivity = Date.now();

  client.roomId = roomId;
  client.clientType = clientType;

  console.log(`Client ${clientId} joined room ${roomId} as ${clientType}`);

  // Send current game state to the new client
  client.ws.send(
    JSON.stringify({
      type: "gameState",
      data: room.gameState,
      timestamp: Date.now(),
    })
  );

  // Notify other clients in the room
  broadcastToRoom(
    roomId,
    {
      type: "clientJoined",
      clientId: clientId,
      clientType: clientType,
      timestamp: Date.now(),
    },
    clientId
  );
}

function leaveRoom(clientId, roomId) {
  const room = gameRooms.get(roomId);
  if (room) {
    room.clients.delete(clientId);
    console.log(`Client ${clientId} left room ${roomId}`);

    // Remove empty rooms
    if (room.clients.size === 0) {
      gameRooms.delete(roomId);
      console.log(`Removed empty room: ${roomId}`);
    } else {
      // Notify other clients
      broadcastToRoom(roomId, {
        type: "clientLeft",
        clientId: clientId,
        timestamp: Date.now(),
      });
    }
  }
}

function updateGameState(clientId, roomId, newState) {
  if (!roomId) {
    console.log(
      `[ERROR] updateGameState called without roomId for client ${clientId}`
    );
    return;
  }

  const room = gameRooms.get(roomId);
  if (!room) {
    console.log(
      `[ERROR] Room ${roomId} not found for updateGameState from client ${clientId}`
    );
    return;
  }

  // Update game state
  room.gameState = { ...room.gameState, ...newState, lastUpdate: Date.now() };
  room.lastActivity = Date.now();

  console.log(`Game state updated in room ${roomId}:`, Object.keys(newState));

  // Broadcast to all clients in the room except sender
  broadcastToRoom(
    roomId,
    {
      type: "gameState",
      data: room.gameState,
      timestamp: Date.now(),
    },
    clientId
  );
}

function broadcastCommand(clientId, roomId, commandData) {
  if (!roomId) {
    console.log(
      `[ERROR] broadcastCommand called without roomId for client ${clientId}`
    );
    return;
  }

  const room = gameRooms.get(roomId);
  if (!room) {
    console.log(
      `[ERROR] Room ${roomId} not found for broadcastCommand from client ${clientId}`
    );
    return;
  }

  room.lastActivity = Date.now();

  console.log(`Broadcasting command in room ${roomId}:`, commandData);

  // Broadcast command to all clients in the room except sender
  broadcastToRoom(
    roomId,
    {
      type: "command",
      data: commandData,
      fromClient: clientId,
      timestamp: Date.now(),
    },
    clientId
  );
}

function broadcastToRoom(roomId, message, excludeClientId = null) {
  const room = gameRooms.get(roomId);
  if (!room) {
    console.log(`[BROADCAST] Room ${roomId} not found`);
    return;
  }

  console.log(
    `[BROADCAST] Room ${roomId} has ${room.clients.size} clients: [${Array.from(
      room.clients
    ).join(", ")}]`
  );
  console.log(`[BROADCAST] Excluding client: ${excludeClientId}`);

  let sentCount = 0;
  let totalClients = 0;
  const now = new Date().toISOString();

  for (const clientId of room.clients) {
    totalClients++;
    if (clientId === excludeClientId) {
      continue;
    }

    const client = clients.get(clientId);
    if (!client) {
      console.log(`[BROADCAST] Client ${clientId} not found in clients map`);
      continue;
    }

    if (client.ws.readyState !== WebSocket.OPEN) {
      console.log(
        `[BROADCAST] Client ${clientId} WebSocket not open (state: ${client.ws.readyState})`
      );
      continue;
    }

    try {
      client.ws.send(JSON.stringify(message));
      sentCount++;
      // Log all outgoing messages with roomId, timestamp, and message
      console.log(
        `[OUT] [${now}] [room:${roomId}] to client:${clientId} ->`,
        JSON.stringify(message)
      );
    } catch (error) {
      console.error(`Error sending to client ${clientId}:`, error);
    }
  }

  if (sentCount > 0) {
    console.log(
      `Broadcasted ${message.type} to ${sentCount} clients in room ${roomId}`
    );
  }
}

// Create HTTP server with CORS support
const server = http.createServer((req, res) => {
  // Real-time log HTML page
  if (req.url === "/log" && req.method === "GET") {
    try {
      const htmlPath = path.join(__dirname, "log-viewer.html");
      const htmlContent = fs.readFileSync(htmlPath, "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(htmlContent);
    } catch (error) {
      console.error("Error reading log-viewer.html:", error);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Error loading log viewer");
    }
    return;
  }

  // Real-time log SSE endpoint
  if (req.url === "/log/stream" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    if (typeof res.flushHeaders === "function") res.flushHeaders();
    // Send recent log buffer
    for (const line of logBuffer) {
      // Use the same escaping as pushLog
      function escapeForSSE(str) {
        return String(str)
          .replace(/\\/g, "\\\\")
          .replace(/\r/g, "")
          .replace(/\n/g, " ")
          .replace(/\u2028|\u2029/g, "")
          .replace(/\u0000/g, "");
      }
      res.write(`data: ${escapeForSSE(line)}\n\n`, "utf8");
    }
    // Test log for new connection
    const testMsg = `[LOG] SSE client connected to /log/stream at ${new Date().toISOString()}`;
    function escapeForSSE(str) {
      return String(str)
        .replace(/\\/g, "\\\\")
        .replace(/\r/g, "")
        .replace(/\n/g, " ")
        .replace(/\u2028|\u2029/g, "")
        .replace(/\u0000/g, "");
    }
    res.write(`data: ${escapeForSSE(testMsg)}\n\n`, "utf8");
    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      res.write(":heartbeat\n\n");
    }, 15000);
    logClients.add(res);
    console.log(testMsg);
    req.on("close", () => {
      logClients.delete(res);
      clearInterval(heartbeat);
      const discMsg = `[LOG] SSE client disconnected from /log/stream at ${new Date().toISOString()}`;
      console.log(discMsg);
    });
    return;
  }
  // Enable CORS for all requests
  res.setHeader(
    "Access-Control-Allow-Origin",
    corsOptions.origin === "*" ? "*" : req.headers.origin || "*"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  // Stop/Start endpoint - toggles wheel state based on current spinning status
  if (req.url.startsWith("/toggle/") && req.method === "GET") {
    const roomId = req.url.substring(8); // Remove "/toggle/" prefix

    if (!roomId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Room ID is required" }));
      return;
    }

    const room = gameRooms.get(roomId);
    if (!room) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Room ${roomId} not found` }));
      return;
    }

    // Check current spinning status and determine action
    const isCurrentlySpinning = room.gameState.isSpinning;
    const action = isCurrentlySpinning ? "stop" : "start";

    const command = {
      action: action,
      timestamp: Date.now(),
    };

    // Update room activity
    room.lastActivity = Date.now();

    console.log(
      `HTTP ${action} command for room ${roomId} (was spinning: ${isCurrentlySpinning}):`,
      command
    );

    // Broadcast the command to all clients in the room
    broadcastToRoom(roomId, {
      type: "command",
      data: command,
      fromClient: "http-api",
      timestamp: Date.now(),
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: true,
        roomId: roomId,
        action: action,
        wasSpinning: isCurrentlySpinning,
        command: command,
        clientCount: room.clients.size,
      })
    );
    return;
  }

  // Health check endpoint
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        timestamp: new Date().toISOString(),
        activeRooms: gameRooms.size,
        activeClients: clients.size,
      })
    );
    return;
  }

  // Root endpoint
  if (req.url === "/" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  // WebSocket upgrade handling
  if (req.url === "/ws" || req.url === "/") {
    res.writeHead(426, { "Content-Type": "text/plain" });
    res.end("Upgrade Required");
    return;
  }

  // Default response
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

// Create WebSocket server
const wss = new WebSocket.Server({
  server,
  path: "/ws",
  verifyClient: (info) => {
    // Add custom verification logic if needed
    return true;
  },
});

// Handle WebSocket connections
wss.on("connection", handleWebSocketConnection);

// For Vercel deployment
if (isVercel) {
  // Export handler for Vercel
  module.exports = (req, res) => {
    // Handle HTTP requests
    if (req.method === "GET" && req.url === "/health") {
      res.status(200).json({
        status: "ok",
        timestamp: new Date().toISOString(),
        activeRooms: gameRooms.size,
        activeClients: clients.size,
      });
      return;
    }

    // Root endpoint
    if (req.method === "GET" && req.url === "/") {
      res.status(200).send("ok");
      return;
    }

    // Handle WebSocket upgrade
    if (req.headers.upgrade === "websocket") {
      server.emit("upgrade", req, req.socket, Buffer.alloc(0));
      return;
    }

    res.status(404).json({ error: "Not Found" });
  };
} else {
  // Start server for local development
  const PORT = process.env.PORT || process.env.WS_PORT || 3001;

  // Auto-detect host: use specific IP for local development, 0.0.0.0 for general access
  let HOST;
  if (
    process.env.NODE_ENV === "development" &&
    (process.env.HOST || process.env.WS_HOST)
  ) {
    HOST = process.env.HOST || process.env.WS_HOST;
  } else {
    HOST = "0.0.0.0"; // Listen on all interfaces
  }

  server.listen(PORT, HOST, () => {
    console.log(`🚀 WebSocket server running on ${HOST}:${PORT}`);
    console.log(`📡 WebSocket URL: ws://localhost:${PORT}/ws`);
    if (HOST !== "0.0.0.0" && HOST !== "localhost") {
      console.log(`🌐 External WebSocket URL: ws://${HOST}:${PORT}/ws`);
    } else {
      console.log(`🌐 External WebSocket URL: ws://[YOUR_IP]:${PORT}/ws`);
    }
    console.log(`🎮 Ready for game connections!`);
    console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  });
}

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("Shutting down WebSocket server...");
  wss.close(() => {
    server.close(() => {
      process.exit(0);
    });
  });
});

process.on("SIGINT", () => {
  console.log("Shutting down WebSocket server...");
  wss.close(() => {
    server.close(() => {
      process.exit(0);
    });
  });
});
