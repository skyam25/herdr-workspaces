import './assetPath';
import '@excalidraw/excalidraw/index.css';
import './styles.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { webCompanion } from './web-companion';

createRoot(document.getElementById('root')!).render(<App host={window.companion ?? webCompanion()} />);
