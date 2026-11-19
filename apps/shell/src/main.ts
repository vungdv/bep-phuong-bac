import { createHost } from './app/create-host';

const root = document.getElementById('mf-outlet');
if (!root) {
  throw new Error('Shell frame is broken: #mf-outlet not found in index.html');
}

createHost({ root }).start();
