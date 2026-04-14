# 🚀 GHCountdown - Offline Deployment Guide

## Download & Run Offline

GHCountdown is a **fully local, offline-first productivity app** that runs entirely on your machine with no internet required after initial setup.

---

## 📦 For Mac Users (Primary Platform)

### Option 1: Run with Node.js (Recommended)

#### Prerequisites
- **Node.js 18+** installed ([Download from nodejs.org](https://nodejs.org/))

#### Steps

1. **Download this entire project folder** to your Mac
   - Download as ZIP and extract, or clone with git:
   ```bash
   git clone <your-repo-url> GHCountdown
   cd GHCountdown
   ```

2. **Install dependencies** (one-time setup)
   ```bash
   npm install
   ```

3. **Build the production app**
   ```bash
   npm run build
   ```

4. **Run the local server**
   ```bash
   npm run preview
   ```

5. **Open in your browser**
   - Navigate to: `http://localhost:4173`
   - Bookmark this URL for quick access
   - Works completely offline once loaded

#### Creating a Desktop Shortcut

**Mac:**
```bash
# Create a launch script
cat > ~/Desktop/GHCountdown.command << 'EOF'
#!/bin/bash
cd "/path/to/GHCountdown"
npm run preview
sleep 2
open "http://localhost:4173"
EOF

chmod +x ~/Desktop/GHCountdown.command
```

Replace `/path/to/GHCountdown` with your actual folder path.

Double-click `GHCountdown.command` on your Desktop to launch!

---

### Option 2: Static HTML Build (No Server Required)

For a completely standalone version that opens directly in your browser:

1. **Build the static files**
   ```bash
   npm run build
   ```

2. **Open the built app**
   ```bash
   open dist/index.html
   ```

   Or simply double-click `dist/index.html` in Finder.

**Note:** Some features may have CORS restrictions when running as `file://`. For full functionality, use Option 1.

---

## 🪟 For Windows Users

### Prerequisites
- **Node.js 18+** installed ([Download from nodejs.org](https://nodejs.org/))

### Steps

1. **Download and extract** the project folder

2. **Open PowerShell or Command Prompt** in the project folder

3. **Install dependencies**
   ```cmd
   npm install
   ```

4. **Build the app**
   ```cmd
   npm run build
   ```

5. **Run the preview server**
   ```cmd
   npm run preview
   ```

6. **Open** `http://localhost:4173` in your browser

#### Creating a Desktop Shortcut (Windows)

Create a file named `GHCountdown.bat` on your Desktop:

```batch
@echo off
cd "C:\path\to\GHCountdown"
start http://localhost:4173
npm run preview
```

Replace `C:\path\to\GHCountdown` with your actual path.

---

## 🐧 For Linux Users

Same as Mac instructions, but use your package manager to install Node.js:

```bash
# Ubuntu/Debian
sudo apt install nodejs npm

# Fedora
sudo dnf install nodejs npm

# Arch
sudo pacman -S nodejs npm
```

Then follow the Mac/Windows build steps above.

---

## 📂 Data Storage Location

All your data is stored locally in **IndexedDB** in your browser:

- **Mac (Chrome):** `~/Library/Application Support/Google/Chrome/Default/IndexedDB`
- **Mac (Safari):** `~/Library/Safari/Databases`
- **Mac (Firefox):** `~/Library/Application Support/Firefox/Profiles/<profile>/storage/default`
- **Windows (Chrome):** `%LOCALAPPDATA%\Google\Chrome\User Data\Default\IndexedDB`

### Backing Up Your Data

Use the **Settings → Data Management** section in the app to:
- Export all data to JSON
- Import previously exported data
- CSV export for time entries

---

## 🔄 Updating the App

1. Download the latest version
2. Replace all files (except `node_modules/`)
3. Run `npm install` to update dependencies
4. Run `npm run build` to rebuild
5. Your data persists in the browser's IndexedDB

---

## 🎯 Running on Startup (Mac)

### Create a Launch Agent

1. Create a plist file:
```bash
nano ~/Library/LaunchAgents/com.ghcountdown.app.plist
```

2. Add this content:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.ghcountdown.app</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/path/to/GHCountdown/node_modules/.bin/vite</string>
        <string>preview</string>
        <string>--port</string>
        <string>4173</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/path/to/GHCountdown</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
</dict>
</plist>
```

3. Load the agent:
```bash
launchctl load ~/Library/LaunchAgents/com.ghcountdown.app.plist
```

---

## 🌐 Changing the Port

Edit `package.json` and modify the preview script:

```json
"preview": "vite preview --port 8080"
```

Then rebuild and restart.

---

## 🔒 Security & Privacy

- ✅ **100% Local** - No data ever leaves your machine
- ✅ **No Analytics** - Zero tracking or telemetry
- ✅ **No Internet Required** - Fully offline after installation
- ✅ **Open Source** - Audit the code yourself

---

## 🐛 Troubleshooting

### "Cannot find module" errors
```bash
rm -rf node_modules package-lock.json
npm install
```

### Port already in use
```bash
# Kill process on port 4173 (Mac/Linux)
lsof -ti:4173 | xargs kill

# Windows
netstat -ano | findstr :4173
taskkill /PID <PID> /F
```

### Data not persisting
- Check browser settings: ensure cookies/local storage is enabled
- Try a different browser
- Export your data regularly as backup

### Build fails
```bash
# Clear Vite cache
rm -rf dist .vite node_modules/.vite
npm run build
```

---

## 💡 Advanced: Electron Desktop App (Future)

Want a true desktop app? The codebase is structured to support Electron packaging:

```bash
# Install Electron (future enhancement)
npm install electron electron-builder --save-dev
```

We've kept the architecture portable for easy Electron/Tauri migration.

---

## 📧 Support

For issues or questions:
1. Check the troubleshooting section above
2. Review the PRD.md for feature documentation
3. Open an issue on the repository

---

**Enjoy your fully local, offline-first productivity powerhouse! 🎉**
