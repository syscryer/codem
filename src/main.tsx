import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initializeApiFetchBridge, installApiFetchBridge } from './lib/api-fetch-bridge';
import './styles.css';

await initializeApiFetchBridge();
installApiFetchBridge();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
