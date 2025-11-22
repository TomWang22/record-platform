#!/bin/bash
# Quick script to start the frontend

echo "🚀 Starting Record Platform Frontend..."
echo ""
echo "📦 Installing dependencies (if needed)..."
pnpm install

echo ""
echo "🎨 Starting development server..."
echo "   The webapp will be available at: http://localhost:3001"
echo ""
echo "   Press Ctrl+C to stop"
echo ""

pnpm dev
