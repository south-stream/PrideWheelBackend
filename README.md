# Pride Wheel Backend

WebSocket server for the Pride Wheel game that supports both ws and wss connections, optimized for Vercel deployment.

## Features

- 🔄 Real-time WebSocket communication
- 🏠 Game room management
- 🎮 Game state synchronization
- 🔒 Support for both ws and wss protocols
- 🌐 Vercel deployment ready
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

### Running locally

```bash
npm run dev
```

The server will start on `http://localhost:8080` with WebSocket endpoint at `ws://localhost:8080/ws`.

### Health Check

Visit `http://localhost:8080/health` to check server status.

## Vercel Deployment

### Prerequisites

1. Install Vercel CLI: `npm i -g vercel`
2. Login to Vercel: `vercel login`

### Deploy

```bash
vercel
```

### Environment Variables

Set these environment variables in your Vercel dashboard:

- `NODE_ENV`: Set to `production`
- `ALLOWED_ORIGINS`: Comma-separated list of allowed origins (optional, defaults to `*`)

### WebSocket Connection

After deployment, your WebSocket URL will be:
- WSS (secure): `wss://your-app-name.vercel.app/ws`
- WS (development): `ws://localhost:8080/ws`

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
