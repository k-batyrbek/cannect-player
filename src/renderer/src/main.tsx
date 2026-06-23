import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

// Без StrictMode: двойной прогон эффектов в dev ломает play()/события медиаплеера.
createRoot(document.getElementById('root')!).render(<App />)
