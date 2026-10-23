import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './glasswave-layout.css';
import './library-card-grid.css';
import './hero-artwork.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('The application root is unavailable.');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
