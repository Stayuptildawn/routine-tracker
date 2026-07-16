import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/atkinson-hyperlegible/400.css'
import '@fontsource/atkinson-hyperlegible/700.css'
import '@fontsource-variable/bitter'
import App from './App'
import './index.css'
import './lib/pwaInstall' // register the beforeinstallprompt capture as early as possible
import { armViewportFix } from './lib/viewportFix'

armViewportFix()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
