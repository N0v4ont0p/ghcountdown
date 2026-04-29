import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from "react-error-boundary";
import "@github/spark/spark"

import App from './App.tsx'
import { ErrorFallback } from './ErrorFallback.tsx'

import "./main.css"
import "./styles/theme.css"
import "./index.css"

// Mark the document so window-specific styles (transparent backgrounds,
// no-scroll, etc.) can target the dedicated launcher BrowserWindow.
if (typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('launcher') === '1') {
  document.body.classList.add('launcher-window');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
