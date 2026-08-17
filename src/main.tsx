import React from 'react';
import ReactDOM from 'react-dom/client';
const isMobilePrototypeRoute = window.location.pathname === '/mobile/prototype';
const isMobileRoute = window.location.pathname === '/mobile' || window.location.pathname.startsWith('/mobile/');

if (!isMobileRoute) {
  const { initializeApiFetchBridge, installApiFetchBridge } = await import('./lib/api-fetch-bridge');
  await initializeApiFetchBridge();
  installApiFetchBridge();
}

let App: React.ComponentType;
if (isMobilePrototypeRoute) {
  await import('./styles.css');
  App = (await import('./mobile/prototype/MobilePrototypeApp')).default;
} else if (isMobileRoute) {
  const { installClientIdCompatibility } = await import('./lib/client-id');
  installClientIdCompatibility();
  await import('./mobile/mobile.css');
  const [{ default: MobileApp }, { MobileErrorBoundary }] = await Promise.all([
    import('./mobile/MobileApp'),
    import('./mobile/MobileErrorBoundary'),
  ]);
  App = () => <MobileErrorBoundary><MobileApp /></MobileErrorBoundary>;
} else {
  await import('./styles.css');
  App = (await import('./App')).default;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
