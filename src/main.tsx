import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installApiFetchBridge } from './lib/api-fetch-bridge';
import './styles.css';

installApiFetchBridge();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
