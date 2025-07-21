const WebSocket = require("ws");
const http = require("http");
const https = require("https");
const url = require("url");
const cors = require("cors");

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

  console.log(`Message from ${clientId}:`, message.type);

  switch (message.type) {
    case "join":
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
  const room = gameRooms.get(roomId);
  if (!room) return;

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
  const room = gameRooms.get(roomId);
  if (!room) return;

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
  if (!room) return;

  let sentCount = 0;
  for (const clientId of room.clients) {
    if (clientId === excludeClientId) continue;

    const client = clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(JSON.stringify(message));
        sentCount++;
      } catch (error) {
        console.error(`Error sending to client ${clientId}:`, error);
      }
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
