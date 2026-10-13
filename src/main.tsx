import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { installerTableauxAdaptatifs } from './lib/tableauxAdaptatifs';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Une fois pour toute l'application : un tableau qu'une page oublierait
// d'adapter déborderait de l'écran du téléphone.
installerTableauxAdaptatifs();
