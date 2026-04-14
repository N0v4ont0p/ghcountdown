#!/bin/bash

# GHCountdown Launcher for Linux
# This script starts the local server and opens GHCountdown in your default browser

# Color codes for terminal output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║       GHCountdown - Starting...        ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Change to the project directory
cd "$SCRIPT_DIR" || exit 1

# Check if node is installed
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}⚠️  Node.js is not installed!${NC}"
    echo ""
    echo "Please install Node.js:"
    echo "  Ubuntu/Debian: sudo apt install nodejs npm"
    echo "  Fedora: sudo dnf install nodejs npm"
    echo "  Arch: sudo pacman -S nodejs npm"
    echo ""
    read -p "Press any key to exit..."
    exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 Installing dependencies (first-time setup)...${NC}"
    npm install
    echo ""
fi

# Check if dist folder exists, if not build
if [ ! -d "dist" ]; then
    echo -e "${YELLOW}🔨 Building the app (first-time setup)...${NC}"
    npm run build
    echo ""
fi

# Start the preview server in the background
echo -e "${GREEN}🚀 Starting local server...${NC}"
npm run preview &
SERVER_PID=$!

# Wait for server to be ready
echo -e "${BLUE}⏳ Waiting for server to start...${NC}"
sleep 3

# Open in default browser (try xdg-open, gnome-open, or firefox)
echo -e "${GREEN}🌐 Opening GHCountdown in your browser...${NC}"
if command -v xdg-open &> /dev/null; then
    xdg-open "http://localhost:4173"
elif command -v gnome-open &> /dev/null; then
    gnome-open "http://localhost:4173"
elif command -v firefox &> /dev/null; then
    firefox "http://localhost:4173" &
else
    echo -e "${YELLOW}Could not auto-open browser. Please navigate to: http://localhost:4173${NC}"
fi

echo ""
echo -e "${GREEN}✅ GHCountdown is running!${NC}"
echo ""
echo -e "${BLUE}📍 URL: http://localhost:4173${NC}"
echo -e "${YELLOW}⚠️  Keep this terminal open while using the app${NC}"
echo ""
echo -e "Press ${BLUE}Ctrl+C${NC} to stop the server and close GHCountdown"
echo ""

# Wait for the server process
wait $SERVER_PID
