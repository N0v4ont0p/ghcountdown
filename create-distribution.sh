#!/bin/bash

# GHCountdown Distribution Packager
# Creates a clean ZIP file ready for distribution

set -e

VERSION="1.0.0"
APP_NAME="GHCountdown"
DIST_NAME="${APP_NAME}-v${VERSION}"

echo "════════════════════════════════════════"
echo "  GHCountdown Distribution Packager"
echo "════════════════════════════════════════"
echo ""
echo "Creating distribution package: ${DIST_NAME}.zip"
echo ""

# Clean up any previous dist
if [ -f "${DIST_NAME}.zip" ]; then
    echo "Removing old package..."
    rm "${DIST_NAME}.zip"
fi

# Create a temporary staging directory
STAGING_DIR="/tmp/${DIST_NAME}"
if [ -d "$STAGING_DIR" ]; then
    rm -rf "$STAGING_DIR"
fi

mkdir -p "$STAGING_DIR"

echo "Copying files to staging area..."

# Copy all necessary files
cp -r src "$STAGING_DIR/"
cp -r public "$STAGING_DIR/" 2>/dev/null || true

# Copy configuration files
cp package.json "$STAGING_DIR/"
cp package-lock.json "$STAGING_DIR/" 2>/dev/null || true
cp tsconfig.json "$STAGING_DIR/"
cp vite.config.ts "$STAGING_DIR/"
cp tailwind.config.js "$STAGING_DIR/"
cp components.json "$STAGING_DIR/" 2>/dev/null || true
cp index.html "$STAGING_DIR/"

# Copy launch scripts
cp start-mac.sh "$STAGING_DIR/"
cp start-windows.bat "$STAGING_DIR/"
cp start-linux.sh "$STAGING_DIR/"
cp verify-build.sh "$STAGING_DIR/"

# Copy documentation
cp README.md "$STAGING_DIR/"
cp QUICKSTART.md "$STAGING_DIR/"
cp DOWNLOAD-AND-RUN.md "$STAGING_DIR/"
cp DEPLOYMENT.md "$STAGING_DIR/"
cp DEPLOYMENT-CHECKLIST.md "$STAGING_DIR/"
cp CHANGELOG.md "$STAGING_DIR/"
cp PACKAGE-INFO.md "$STAGING_DIR/"
cp PRD.md "$STAGING_DIR/" 2>/dev/null || true
cp LICENSE "$STAGING_DIR/" 2>/dev/null || true

# Create .gitignore for users
cat > "$STAGING_DIR/.gitignore" << 'EOF'
# Dependencies
node_modules/
package-lock.json

# Build output
dist/
.vite/

# Environment
.env
.env.local

# OS files
.DS_Store
Thumbs.db
desktop.ini

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# Logs
*.log
npm-debug.log*
pids/

# Testing
coverage/
.nyc_output/

# Misc
.cache/
EOF

# Make scripts executable in the package
chmod +x "$STAGING_DIR/start-mac.sh"
chmod +x "$STAGING_DIR/start-linux.sh"
chmod +x "$STAGING_DIR/verify-build.sh"

echo "Creating ZIP archive..."

# Create the ZIP from the staging directory
cd /tmp
zip -r "${DIST_NAME}.zip" "${DIST_NAME}/" \
    -x "*/node_modules/*" \
    -x "*/dist/*" \
    -x "*/.git/*" \
    -x "*/pids/*" \
    -x "*/.DS_Store" \
    -q

# Move to current directory
mv "${DIST_NAME}.zip" "$OLDPWD/"

# Clean up
rm -rf "$STAGING_DIR"

cd "$OLDPWD"

echo ""
echo "✅ Package created successfully!"
echo ""
echo "📦 File: ${DIST_NAME}.zip"
echo "📊 Size: $(du -h "${DIST_NAME}.zip" | cut -f1)"
echo ""
echo "🚀 Distribution ready!"
echo ""
echo "Next steps:"
echo "  1. Test the package by extracting and running"
echo "  2. Upload to GitHub releases"
echo "  3. Share with users"
echo ""
echo "Users should:"
echo "  1. Extract the ZIP file"
echo "  2. Run start-mac.sh (or platform equivalent)"
echo "  3. Wait for auto-setup (first time only)"
echo "  4. Start using GHCountdown!"
echo ""
