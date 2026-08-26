import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './App.css'
import App from './App.tsx'

// ?debug=1 loads an in-page devtools console (Network/Console tabs) — for
// diagnosing on a phone with no way to plug into a computer's devtools.
if (new URLSearchParams(location.search).has('debug')) {
  import('eruda').then((eruda) => eruda.default.init())
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
