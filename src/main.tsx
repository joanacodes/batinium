import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { installerTableauxAdaptatifs } from './lib/tableauxAdaptatifs';
import { appliquerApparence, THEME_PAR_DEFAUT, TON_PAR_DEFAUT } from './lib/apparence';

// Avant le premier rendu : l'écran de connexion et l'attente de la session
// s'affichent déjà au ton du téléphone. Le thème de l'entreprise remplace
// celui-ci dès que la base a répondu (App.tsx).
appliquerApparence(THEME_PAR_DEFAUT, TON_PAR_DEFAUT);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Une fois pour toute l'application : un tableau qu'une page oublierait
// d'adapter déborderait de l'écran du téléphone.
installerTableauxAdaptatifs();
