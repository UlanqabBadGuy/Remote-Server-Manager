import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    hmr: host
      ? { protocol: 'ws', host, port: 5175 }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
})
