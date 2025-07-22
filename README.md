# Pride Wheel Backend

WebSocket server for the Pride Wheel game that supports both ws and wss connections.

## Features

- 🔄 Real-time WebSocket communication
- 🏠 Game room management
- 🎮 Game state synchronization
- 🔒 Support for both ws and wss protocols
- 🏥 Health check endpoint
- 🧹 Automatic room cleanup

## Local Development

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
npm install
```

### Configuration

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

#### Host Configuration Options:

1. **All interfaces (recommended for deployment):**

   ```bash
   # Don't set HOST/WS_HOST or set to 0.0.0.0
   npm run dev
   ```

2. **Specific IP (for local network access):**

   ```bash
   # Set in .env file:
   HOST=192.168.1.218
   npm run dev
   ```

3. **Quick network access:**
   ```bash
   npm run dev:network
   ```

### Running locally

```bash
# Standard development (uses .env)
npm run dev

# Development with specific local config
npm run dev:local

# Development accessible from network
npm run dev:network
```

The server will start on the configured port with WebSocket endpoint at `/ws`.

### Health Check

Visit `http://localhost:3001/health` to check server status.

## API Endpoints

### WebSocket Messages

#### Client to Server

```json
{
  "type": "join",
  "roomId": "room123",
  "clientType": "player"
}
```

```json
{
  "type": "gameState",
  "roomId": "room123",
  "data": {
    "isSpinning": true,
    "categories": ["Category1", "Category2"]
  }
}
```

```json
{
  "type": "command",
  "roomId": "room123",
  "data": {
    "action": "spin",
    "parameters": {}
  }
}
```

```json
{
  "type": "ping"
}
```

#### Server to Client

```json
{
  "type": "connected",
  "clientId": "abc123",
  "timestamp": 1234567890
}
```

```json
{
  "type": "gameState",
  "data": {
    "isSpinning": false,
    "winner": "Category1",
    "categories": []
  },
  "timestamp": 1234567890
}
```

```json
{
  "type": "clientJoined",
  "clientId": "def456",
  "clientType": "viewer",
  "timestamp": 1234567890
}
```

```json
{
  "type": "pong",
  "timestamp": 1234567890
}
```

### HTTP Endpoints

- `GET /health` - Health check endpoint
- `GET /ws` - WebSocket upgrade endpoint

## Game Room Management

- Rooms are created automatically when a client joins
- Rooms are cleaned up after 5 minutes of inactivity
- Each room maintains its own game state
- Clients can be either "player" or "viewer" type

## Security Features

- CORS configuration
- Origin validation
- Connection health monitoring
- Automatic cleanup of inactive connections

## Monitoring

The server logs all important events:

- Client connections/disconnections
- Room creation/deletion
- Message handling
- Errors and warnings

## Troubleshooting

### Common Issues

1. **WebSocket connection fails**: Check if the URL is correct and includes `/ws` path
2. **CORS errors**: Set `ALLOWED_ORIGINS` environment variable
3. **Connection drops**: Client should implement reconnection logic with exponential backoff

### Debug Mode

Set `NODE_ENV=development` for more verbose logging.

## License

MIT
