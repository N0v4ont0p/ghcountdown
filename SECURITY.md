# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability in GHCountdown, please **do not** open a public GitHub issue. Instead, report it privately by [opening a GitHub Security Advisory](https://github.com/N0v4ont0p/ghcountdown/security/advisories/new) in this repository.

Please include:
- A clear description of the vulnerability
- Steps to reproduce the issue
- The impact (e.g., data exposure, privilege escalation)
- Any relevant file paths or code snippets

We aim to acknowledge reports within 48 hours and resolve confirmed issues as soon as possible.

## Scope

GHCountdown is a **local-first desktop application** (Electron + web). All user data is stored in IndexedDB on the user's own machine — no data is transmitted to any server owned by this project.

The primary attack surfaces are:
- **Electron IPC bridge** (`electron/main.cjs`, `electron/preload.cjs`) — only whitelisted operations are exposed to the renderer
- **AI API key handling** — keys are held in memory and never written to disk by the app itself; users are responsible for protecting their Hugging Face keys
- **Import / export** — JSON backup files are loaded back into IndexedDB; malformed or crafted files could cause unexpected behaviour

## Out of Scope

- Vulnerabilities in third-party dependencies that are already publicly known and have patches pending upstream
- Issues that require physical access to the user's device
