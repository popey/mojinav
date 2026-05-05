import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Log startup for debugging
console.log('🚀 MojiNav frontend starting...')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
