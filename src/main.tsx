import { startApp } from './App';

window.addEventListener('hashchange', () => location.reload());
void startApp(document.getElementById('root')!);

// Optional offline support (PWA): only on http(s), never in dev, never in safe mode. Failure is silent by design.
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !import.meta.env.DEV && !/[?&]safe\b/.test(location.search)) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js').catch(() => undefined));
}
