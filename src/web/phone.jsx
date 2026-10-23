import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import MobileApp from '../mobile/MobileApp.jsx';
import * as relay from '../mobile/relay.js';

// copycam.app/p: the phone app, linked to a copycam.app tab through the relay
// rather than to the companion over the Wi-Fi.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MobileApp transport={relay} mode="web" />
  </StrictMode>,
);
