import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

if (import.meta.env.DEV && window.location.hostname === '127.0.0.1') {
  const redirectUrl = new URL(window.location.href)
  redirectUrl.hostname = 'localhost'
  window.location.replace(redirectUrl.toString())
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
