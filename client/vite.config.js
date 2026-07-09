import { defineConfig, loadEnv } from 'vite';
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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '');
  const port = env.PORT || '3001';
  const proxyTarget = env.BMS_SERVER_URL || `${hasCert ? 'https' : 'http'}://localhost:${port}`;

  return {
    plugins: [react()],
    server: {
      https: httpsOptions,
      proxy: {
        '/socket.io': {
          target: proxyTarget,
          ws: true,
          secure: false // Bypass self-signed certificate warnings in dev
        }
      }
    }
  };
});
