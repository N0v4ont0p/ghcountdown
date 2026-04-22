<div align="center">

<img src="src/assets/logo.svg" alt="GHCountdown" width="96" height="96" />

# GHCountdown

> A countdown-first productivity app. All data stays on your machine.

[![Electron](https://img.shields.io/badge/Electron-41-47848F?style=for-the-badge&logo=electron&logoColor=white)](https://electronjs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Vite](https://img.shields.io/badge/Vite-7-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev)

</div>

---

## What it is

GHCountdown is a desktop productivity app for people who work to deadlines. The main screen shows a live countdown to your next high-priority event — days, hours, minutes, seconds. Everything else (todos, timeline, stats) is built around that anchor.

It runs as a native Electron app on macOS, or as a web app in any browser. No account. No sync. No server. All data is stored in IndexedDB on your device.

---

## 📋 Views

| View | What it does |
|---|---|
| **Home** | Countdown hero to your next important event, today's time blocks, active todos, deadline pressure strip, momentum indicators, and AI nudges |
| **Timeline** | Hour-by-hour day planner. Create time blocks, start/stop focus timers, see event markers, detect scheduling conflicts, and get habit-based ghost suggestions |
| **Todos** | Inbox → Today workflow. Tabs for Inbox, Today, and Projects. Priority 1–5, due dates, project grouping |
| **Events** | Create and manage deadlines and milestones. Priority, tags, notes, all-day or timed |
| **Stats** | Focus time totals (today / week / month), completed tasks and events, streak tracking, most productive hour, manual time entry log |
| **Settings** | Theme (light / dark / system), AI API key, accent color, priority threshold for countdown hero, timeline hours, data import/export, bulk delete |

---

## 🤖 AI assistant

The AI assistant is accessible from any view via `⌘K` or the sidebar.

It uses the Hugging Face inference router with model `openai/gpt-oss-120b`. You provide your own API key — it is stored locally and never sent anywhere except the HuggingFace API endpoint.

**Two modes:**

- **Plan** — analyses your todos, events, and time blocks, then returns a summary and a list of suggested actions (create todo, create event, schedule time block).
- **Agent** — same analysis, but also directly applies the suggestions to your data in one step.

Typing a phrase like "schedule my day" or "plan my day" bypasses the AI and runs a deterministic local scheduling algorithm instead.

**Setup:**

1. Get a Hugging Face API key from [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)
2. Open **Settings → AI API Key** and paste it in, or set it in `.env`:

```env
VITE_HUGGINGFACE_API_KEY=hf_...
```

A morning briefing is generated automatically between 5 am and 11 am (once per day) if an API key is configured.

---

## ⌨️ Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Open AI assistant |
| `⌘F` / `Ctrl+F` | Open universal search |
| `⌘N` / `Ctrl+N` | Quick capture (add todo or event) |

---

## 💾 Data and privacy

- All data is stored in the browser's IndexedDB under the database name `ghcountdown`.
- Nothing leaves your machine unless you use the AI feature (which calls HuggingFace with the text you provide).
- **Export:** Settings → Export JSON backs up all events, todos, time entries, time blocks, and settings to a single JSON file.
- **Import:** Settings → Import JSON restores from a backup file.
- **CSV export** is also available per data type (events, todos, time entries).

---

## 🚀 Install and run

**Requirements:** Node.js 18+

```bash
git clone https://github.com/N0v4ont0p/ghcountdown.git
cd ghcountdown
npm install
```

**Run in browser (dev):**

```bash
npm run dev
```

**Run as Electron app (dev):**

```bash
npm run electron:dev
```

**Preview production build:**

```bash
npm run build
npm run preview
```

---

## 📦 Build the Electron app

> **Primary platform: macOS.** Windows is fully supported as a secondary target.

### Prerequisites

- **Node.js 18+**
- **macOS** is recommended for building both platforms. To produce Windows builds on a Mac you need [Wine](https://www.winehq.org) (for NSIS code-signing only — unsigned builds work without it) and the `--win` flag.
- On **Windows**, you can build the Windows target natively. Building the macOS target from Windows is not supported by Apple.

---

### macOS builds

**Both architectures (Apple Silicon + Intel) — recommended:**

```bash
npm run electron:build:mac
```

**Apple Silicon (arm64) only:**

```bash
npm run electron:build:mac:arm64
```

**Intel (x64) only:**

```bash
npm run electron:build:mac:x64
```

Output goes to `dist-electron/`. Produces `.dmg` and `.zip` archives for each architecture.

---

### Windows builds

**Windows installer + portable (x64):**

```bash
npm run electron:build:win
```

**Windows x64 only (explicit):**

```bash
npm run electron:build:win:x64
```

Output goes to `dist-electron/`. Produces:
- `GHCountdown Setup *.exe` — NSIS installer (lets the user choose install directory, adds Start Menu and Desktop shortcuts)
- `GHCountdown *.exe` — portable executable (no installation required, run it directly)

---

### Build both macOS and Windows in one command

Run this on macOS to produce all Mac and Windows artifacts at once:

```bash
npm run electron:build:all
```

---

### What each script does internally

| Script | What it runs |
|---|---|
| `electron:build:web` | TypeScript compile + Vite production build (sets `ELECTRON_BUILD=1`) |
| `electron:build:mac` | `electron:build:web` → `electron-builder --mac` |
| `electron:build:win` | `electron:build:web` → `electron-builder --win` |
| `electron:build:all` | `electron:build:web` → `electron-builder --mac --win` |

---

## License

MIT
