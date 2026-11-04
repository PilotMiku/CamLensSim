import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SimulatorProvider } from './state/simulator';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SimulatorProvider>
      <App />
    </SimulatorProvider>
  </StrictMode>,
);
