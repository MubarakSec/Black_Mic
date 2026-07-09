import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read development SSL certificates
const keyPath = path.resolve(__dirname, '../server.key');
const certPath = path.resolve(__dirname, '../server.cert');
const hasCert = fs.existsSync(keyPath) && fs.existsSync(certPath);

const httpsOptions = hasCert ? {
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(certPath)
} : undefined;

export default defineConfig({
  plugins: [react()],
  server: {
    https: httpsOptions,
    proxy: {
      '/socket.io': {
        target: hasCert ? 'https://localhost:3001' : 'http://localhost:3001',
        ws: true,
        secure: false // Bypass self-signed certificate warnings in dev
      }
    }
  }
});
