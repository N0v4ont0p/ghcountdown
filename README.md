# 🎯 GHCountdown - Countdown-First Productivity

**A local-first productivity app for Mac, Windows, and Linux**

---

## ✨ What is GHCountdown?

GHCountdown is a **stunning, offline-first productivity powerhouse** that runs entirely on your machine. No cloud, no accounts, no internet required—just you and your data, locally stored and always private.

## ✅ Current Status

- ✅ Core app is production-ready in browser/local-server mode
- ✅ Electron desktop packaging is implemented
- ✅ macOS packaging outputs installable artifacts via Electron Builder
- ✅ Local-first data storage and backup/restore are available

### Key Features

🎯 **Countdown Hero** - Large, animated countdown to your next important event  
📅 **Event Management** - Full calendar with priorities, tags, and notes  
✅ **Smart Todos** - Inbox, Today, and project-based task system  
⏰ **Timeline View** - Visual in-day planning with drag-and-drop blocks  
📊 **Weekly Calendar** - Week-at-a-glance with all your commitments  
⏱ **Time Tracking** - Auto-tracking and manual timers for deep work  
📈 **Statistics** - Beautiful productivity insights and charts  
🌓 **Gorgeous Themes** - Polished light and dark modes

---

## 🚀 Quick Start

### For Mac Users (Primary Platform)

#### Option A — Electron Desktop App (`.app` via `.dmg`)

```bash
npm install

# M1/M2/M3/M4 Mac (Apple Silicon — arm64, recommended for most users):
npm run electron:build:mac:arm64

# Intel Mac (x64):
npm run electron:build:mac:x64

# Universal build (both archs, slower — downloads ~300 MB on first run):
npm run electron:build:mac
```

Build output is written to `dist-electron/` (`.dmg` and `.zip` for the selected arch). Open the `.dmg` and drag **GHCountdown** into Applications.

#### Option B — Browser / Local Server

1. **Download** this folder to your Mac
2. **Make launcher executable:**
   ```bash
   chmod +x start-mac.sh
   ```
3. **Run it:**
   ```bash
   ./start-mac.sh
   ```
   Or double-click `start-mac.sh` in Finder

4. **Done!** GHCountdown opens in your browser

### For Windows Users

1. **Download** this folder
2. **Double-click** `start-windows.bat`
3. **Done!** App launches automatically

### For Linux Users

1. **Download** this folder
2. **Make launcher executable:**
   ```bash
   chmod +x start-linux.sh
   ```
3. **Run it:**
   ```bash
   ./start-linux.sh
   ```

---

## 📋 Requirements

- **Node.js 18+** ([Download here](https://nodejs.org/))
- Any modern browser (Chrome, Firefox, Safari, Edge)
- **No internet required** after installation
- For macOS Electron builds: **Xcode Command Line Tools** (`xcode-select --install`)

---

## 📖 Documentation

- **[QUICKSTART.md](QUICKSTART.md)** - Get running in 3 steps
- **[DOWNLOAD-AND-RUN.md](DOWNLOAD-AND-RUN.md)** - End-user setup + Electron app packaging
- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Full deployment guide with shortcuts, startup configs, and troubleshooting
- **[PRD.md](PRD.md)** - Complete product requirements and design philosophy

---

## 💾 Data Storage

All your data lives in **IndexedDB** in your browser:
- ✅ 100% local, 100% private
- ✅ No cloud sync, no external services
- ✅ Export/import from Settings for backups
- ✅ Portable across machines

---

## ⌨️ Keyboard Shortcuts

- `⌘K` / `Ctrl+K` - Command palette
- `N` - New event
- `T` - New todo  
- `Space` - Start/stop timer

---

## 🎨 Built With

- **React 19** + TypeScript
- **Tailwind CSS** + Framer Motion
- **IndexedDB** for local storage
- **Vite** for blazing-fast builds
- **shadcn/ui** components
- **Recharts** for beautiful visualizations

---

## 🔒 Privacy & Security

- ✅ **Zero telemetry** - No tracking, no analytics
- ✅ **Fully offline** - Works without internet
- ✅ **Local-only** - Your data never leaves your machine
- ✅ **Open source** - Audit the code yourself

---

## 🐛 Troubleshooting

### Port already in use?
```bash
# Kill the process (Mac/Linux)
lsof -ti:4173 | xargs kill

# Or change the port in package.json:
"preview": "vite preview --port 8080"
```

### Dependencies not installing?
```bash
rm -rf node_modules package-lock.json
npm install
```

### More help?
See **[DEPLOYMENT.md](DEPLOYMENT.md)** for comprehensive troubleshooting.

---

## 📦 What Gets Downloaded

When you download this app, you get:
- Source code (TypeScript/React)
- Build configuration (Vite)
- Launch scripts (Mac/Windows/Linux)
- Complete documentation
- **No executable binaries** - builds fresh on your machine for security

First launch takes 2-3 minutes to set up, then instant thereafter!

---

## 🚧 Roadmap

Future enhancements:
- [ ] Import from calendar files (.ics)
- [ ] Custom recurring event patterns
- [ ] Themes marketplace
- [ ] Mobile companion view

---

## 🤝 Contributing

This is a local-first app built with privacy in mind. Feel free to:
- Fork and customize for your needs
- Submit issues or feature requests
- Share your themes and presets

---

## 📄 License

The Spark Template files and resources from GitHub are licensed under the terms of the MIT license, Copyright GitHub, Inc.

---

## 🎉 Enjoy!

**GHCountdown** is designed to be your **personal productivity companion**—fast, beautiful, and completely under your control.

No subscriptions. No accounts. No cloud. Just pure productivity. ⚡

---

**Made with ❤️ for makers who value privacy and local-first software**
