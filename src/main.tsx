import React from 'react';
import { createRoot } from 'react-dom/client';
import { StatusBar, Style } from '@capacitor/status-bar';
import { App } from './App';
import { native } from './net/platform';
import { hydrate } from './net/storage';
import './styles/tokens.css';
import './styles/felt.css';
import './styles/game.css';
if (native) { document.documentElement.classList.add('native'); void StatusBar.setStyle({ style: Style.Dark }).catch(() => {}); }
void hydrate().then(() => createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>));
