import { TheoUIProvider, violetForge } from '@theokit/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root não encontrado no index.html');

createRoot(root).render(
  <StrictMode>
    {/* Mesma configuração do cloud/dashboard: Violet Forge, dark travado.
        respectSystemMode:false e storageKey:null porque um protótipo de
        alinhamento não deve variar de aparência conforme o SO de quem abre. */}
    <TheoUIProvider
      theme={{
        themes: [violetForge],
        defaultTheme: 'violet-forge',
        defaultMode: 'dark',
        respectSystemMode: false,
        storageKey: null,
      }}
    >
      <App />
    </TheoUIProvider>
  </StrictMode>,
);
