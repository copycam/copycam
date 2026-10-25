import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import HostApp from './HostApp.jsx';
import { createReader } from './reader.js';
import { connectHost } from '../../shared/relay-host.js';

// copycam.app/app. The reader starts loading at once, before anything is
// scanned, so it's usually ready by the time the phone is linked.
const reader = createReader();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HostApp reader={reader} connect={connectHost} />
  </StrictMode>,
);
