#!/bin/bash

# GHCountdown Build Verification Script
# Ensures everything is ready for offline deployment

set -e

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  GHCountdown Build Verification       ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Check Node.js
echo -e "${YELLOW}[1/6]${NC} Checking Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo -e "  ${GREEN}✓${NC} Node.js ${NODE_VERSION} installed"
else
    echo -e "  ${RED}✗${NC} Node.js not found!"
    echo -e "  ${YELLOW}→${NC} Install from: https://nodejs.org/"
    exit 1
fi

# Check npm
echo -e "${YELLOW}[2/6]${NC} Checking npm..."
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    echo -e "  ${GREEN}✓${NC} npm ${NPM_VERSION} installed"
else
    echo -e "  ${RED}✗${NC} npm not found!"
    exit 1
fi

# Install dependencies
echo -e "${YELLOW}[3/6]${NC} Installing dependencies..."
if [ -d "node_modules" ]; then
    echo -e "  ${GREEN}✓${NC} Dependencies already installed"
else
    npm install
    echo -e "  ${GREEN}✓${NC} Dependencies installed"
fi

# Run build
echo -e "${YELLOW}[4/6]${NC} Building production app..."
npm run build
echo -e "  ${GREEN}✓${NC} Build completed"

# Verify dist folder
echo -e "${YELLOW}[5/6]${NC} Verifying build output..."
if [ -d "dist" ]; then
    DIST_SIZE=$(du -sh dist | cut -f1)
    echo -e "  ${GREEN}✓${NC} Build output: ${DIST_SIZE}"
    
    # Check for critical files
    if [ -f "dist/index.html" ]; then
        echo -e "  ${GREEN}✓${NC} index.html found"
    else
        echo -e "  ${RED}✗${NC} index.html missing!"
        exit 1
    fi
    
    if [ -d "dist/assets" ]; then
        ASSETS_COUNT=$(ls -1 dist/assets | wc -l)
        echo -e "  ${GREEN}✓${NC} ${ASSETS_COUNT} asset files generated"
    else
        echo -e "  ${YELLOW}⚠${NC} No assets folder found"
    fi
else
    echo -e "  ${RED}✗${NC} Build failed - no dist folder!"
    exit 1
fi

# Test IndexedDB compatibility
echo -e "${YELLOW}[6/6]${NC} Checking database setup..."
if grep -q "indexedDB" src/db/core.ts; then
    echo -e "  ${GREEN}✓${NC} IndexedDB configured for offline storage"
else
    echo -e "  ${YELLOW}⚠${NC} Database configuration not found"
fi

echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ✅ Build Verification Complete!       ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo -e "  1. Run: ${GREEN}npm run preview${NC}"
echo -e "  2. Open: ${BLUE}http://localhost:4173${NC}"
echo -e "  3. Or use: ${GREEN}./start-mac.sh${NC} (auto-opens browser)"
echo ""
echo -e "${YELLOW}To deploy:${NC}"
echo -e "  • Share the entire project folder"
echo -e "  • Recipients run: ${GREEN}./start-mac.sh${NC}"
echo -e "  • Everything works offline!"
echo ""
