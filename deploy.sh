#!/bin/bash

# Pride Wheel Backend Deployment Script

echo "🎡 Pride Wheel Backend Deployment"
echo "================================="

# Check if Vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "❌ Vercel CLI is not installed. Please install it with: npm i -g vercel"
    exit 1
fi

# Check if user is logged in to Vercel
if ! vercel whoami &> /dev/null; then
    echo "❌ You are not logged in to Vercel. Please run: vercel login"
    exit 1
fi

echo "✅ Vercel CLI is ready"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo "✅ Dependencies installed"

# Run a basic test
echo "🧪 Running basic tests..."
node -e "
const fs = require('fs');
const path = require('path');

// Check if all required files exist
const requiredFiles = ['index.js', 'package.json', 'vercel.json'];
const missingFiles = requiredFiles.filter(file => !fs.existsSync(file));

if (missingFiles.length > 0) {
    console.error('❌ Missing required files:', missingFiles.join(', '));
    process.exit(1);
}

// Check package.json structure
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (!pkg.dependencies || !pkg.dependencies.ws) {
    console.error('❌ Missing ws dependency in package.json');
    process.exit(1);
}

console.log('✅ All required files are present');
"

if [ $? -ne 0 ]; then
    echo "❌ Basic tests failed"
    exit 1
fi

echo "✅ Basic tests passed"

# Deploy to Vercel
echo "🚀 Deploying to Vercel..."
vercel --prod

if [ $? -ne 0 ]; then
    echo "❌ Deployment failed"
    exit 1
fi

echo "✅ Deployment successful!"
echo ""
echo "🎉 Your Pride Wheel Backend is now deployed!"
echo "📝 Don't forget to update your frontend to use the new WebSocket URL"
echo "🔗 WebSocket URL format: wss://your-deployment-url.vercel.app/ws"
echo "🏥 Health check: https://your-deployment-url.vercel.app/health"
