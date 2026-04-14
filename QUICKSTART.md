# 🎯 GHCountdown - Quick Start Guide

## ⚡ Get Started in 3 Steps

### 1️⃣ Download
Download this entire folder to your computer

### 2️⃣ Run the Launcher

**Mac Users:**
```bash
chmod +x start-mac.sh
./start-mac.sh
```
Or double-click `start-mac.sh` in Finder (after making it executable)

**Windows Users:**
Double-click `start-windows.bat`

**Linux Users:**
```bash
chmod +x start-linux.sh
./start-linux.sh
```

### 3️⃣ Use GHCountdown!
The app will automatically open in your browser at `http://localhost:4173`

---

## 📱 What You Get

✅ **Countdown Hero** - Big, beautiful countdown to your next important event  
✅ **Events Management** - Create, edit, and organize all your events  
✅ **Todo System** - Inbox, Today, and Project-based task management  
✅ **Timeline View** - Visual in-day planning with drag-and-drop time blocks  
✅ **Weekly Calendar** - See your week at a glance  
✅ **Time Tracking** - Automatic and manual time tracking for tasks  
✅ **Statistics** - Productivity insights and charts  
✅ **Dark/Light Mode** - Beautiful themes that adapt to your preference  

---

## 💾 Your Data

All data is stored **locally on your machine** in your browser's IndexedDB:
- No cloud, no servers, no accounts
- Fully offline after first launch
- Export/import from Settings for backups

---

## ⌨️ Keyboard Shortcuts

- `⌘K` (Mac) / `Ctrl+K` (Windows/Linux) - Quick command palette
- `N` - New event
- `T` - New todo
- `Space` - Start/stop timer (when focused)

---

## 🔄 First-Time Setup

The launcher scripts will automatically:
1. Install dependencies (if needed)
2. Build the app (if needed)
3. Start the local server
4. Open your browser

**This takes 2-3 minutes the first time**, then launches instantly after that!

---

## 🛠 Manual Setup (Advanced)

If the launcher doesn't work, run these commands:

```bash
# Install dependencies
npm install

# Build the app
npm run build

# Start the server
npm run preview
```

Then open `http://localhost:4173` in your browser.

---

## 📖 Full Documentation

See `DEPLOYMENT.md` for:
- Desktop shortcuts
- Running on startup
- Changing ports
- Backing up data
- Troubleshooting

---

## 🎨 Customization

All settings accessible from the ⚙️ Settings menu:
- Theme (Light/Dark/System)
- Priority thresholds
- Timeline hours
- Data export/import

---

**Made with ❤️ for Mac (and Windows/Linux too!)**
