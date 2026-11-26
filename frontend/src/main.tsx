import '@fontsource-variable/inter';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { preloadIllustration } from './components/ui/LottieIllustration';
import { startSessionKeepAlive, wakeServer } from './services/session';
import './state/themeStore';
import './styles.css';

// Start waking the API before anything renders — it may be asleep
wakeServer();
startSessionKeepAlive();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Once the first screen is up, fetch the animations in the background so they appear
// instantly — the error one most of all, since it shows when the network is failing.
const whenIdle = (fn: () => void) =>
  'requestIdleCallback' in window ? window.requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 1500);
whenIdle(() => {
  void preloadIllustration('error').then(() => {
    void preloadIllustration('rendering');
    void preloadIllustration('cut-video');
    void preloadIllustration('not-found');
  });
});
