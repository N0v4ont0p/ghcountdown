# 📥 Download & Run GHCountdown

**Get up and running in under 5 minutes!**

---

## 🖥 For Mac Users

You have **two ways** to run GHCountdown on Mac:

---

### Option A — 🖥 Electron Desktop App (true `.app`, no server needed)

This builds a native macOS `.app` file you can drag to your Applications folder and launch like any other app. It runs fully offline with no terminal or server required.

**Prerequisites:** Node.js (https://nodejs.org/) and Xcode Command Line Tools (`xcode-select --install`)

```bash
# Install dependencies
npm install

# Build the .app (outputs to dist-electron/)
npm run electron:build:mac
```

After the build finishes, open `dist-electron/` — you'll find a `.dmg` installer and a `.zip` archive. Open the `.dmg`, drag **GHCountdown** to Applications, and you're done. 🎉

> **Intel + Apple Silicon:** The build produces separate `x64` and `arm64` binaries so it works natively on both chip types.

---

### Option B — 🌐 Browser / Local Server (original method)

### Step 1: Download
Download this entire folder to your Mac (e.g., to `Downloads` or `Documents`)

### Step 2: Open Terminal
Open Terminal app (find it in Applications → Utilities)

### Step 3: Navigate to the folder
```bash
cd ~/Downloads/GHCountdown
```
(Adjust path if you downloaded elsewhere)

### Step 4: Make the launcher executable
```bash
chmod +x start-mac.sh
```

### Step 5: Run it!
```bash
./start-mac.sh
```

**That's it!** The first time takes 2-3 minutes to set up. After that, it launches instantly!

### 💡 Tip: Create a Desktop Shortcut
After first successful launch, drag `start-mac.sh` to your Desktop while holding Option key to create an alias. Double-click it anytime to launch GHCountdown!

---

## 🪟 For Windows Users

### Step 1: Download
Download and extract this folder anywhere (e.g., `C:\GHCountdown`)

### Step 2: Install Node.js
If you don't have Node.js installed:
1. Go to https://nodejs.org/
2. Download the LTS version
3. Run the installer

### Step 3: Run the launcher
Simply **double-click** `start-windows.bat`

**Done!** The script handles everything automatically!

### 💡 Tip: Pin to Taskbar
Right-click `start-windows.bat` → Send to → Desktop. Then drag from Desktop to Taskbar for quick access!

---

## 🐧 For Linux Users

### Step 1: Download
Download this folder to your system

### Step 2: Install Node.js (if needed)
```bash
# Ubuntu/Debian
sudo apt install nodejs npm

# Fedora
sudo dnf install nodejs npm

# Arch
sudo pacman -S nodejs npm
```

### Step 3: Navigate and launch
```bash
cd ~/Downloads/GHCountdown
chmod +x start-linux.sh
./start-linux.sh
```

**All set!** The app will open in your default browser!

---

## ❓ Troubleshooting

### "Command not found: node"
**You need to install Node.js first:**
- Mac: Download from https://nodejs.org/ or use Homebrew: `brew install node`
- Windows: Download from https://nodejs.org/
- Linux: Use your package manager (see Step 2 above)

### "Permission denied"
**On Mac/Linux, make the script executable:**
```bash
chmod +x start-mac.sh    # or start-linux.sh
```

### "Port 4173 already in use"
**Another instance is running. Either:**
- Close the existing window, or
- Kill the process:
  - Mac/Linux: `lsof -ti:4173 | xargs kill`
  - Windows: Task Manager → End "Node.js" process

### Script runs but browser doesn't open
**Manually open your browser and go to:**
```
http://localhost:4173
```

### Still having issues?
Check the full troubleshooting guide in `DEPLOYMENT.md`

---

## 🎯 What Happens on First Launch?

1. **Dependencies Install** (2-3 minutes)
   - Downloads all required packages
   - Only happens once

2. **App Build** (~1 minute)
   - Compiles the production-ready app
   - Only happens once

3. **Server Starts** (< 5 seconds)
   - Launches local web server
   - Happens every time

4. **Browser Opens**
   - Your default browser opens to GHCountdown
   - Ready to use!

**Subsequent launches take only 3-5 seconds!**

---

## 💾 Your Data

Everything is stored **locally on your computer** in your browser's database:
- No internet required (after first setup)
- No accounts, no cloud, no external services
- 100% private and under your control

**To backup your data:**
1. Open GHCountdown
2. Go to Settings (⚙️)
3. Click "Export JSON"
4. Save the file somewhere safe

**To restore your data:**
1. Go to Settings
2. Click "Import from Backup"
3. Select your backup file

---

## 🚀 You're All Set!

**GHCountdown is now running locally on your machine!**

- Create your first event with the big countdown
- Add todos to plan your day
- Use the timeline for visual time blocking
- Track your productivity automatically

Need more help? Check out:
- `QUICKSTART.md` - Feature overview
- `DEPLOYMENT.md` - Advanced configuration
- `PRD.md` - Full feature documentation

**Enjoy your countdown-first productivity! ⚡**
