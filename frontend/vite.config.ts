import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      '/upload': process.env.VITE_API_BASE || 'https://cuex-backend.onrender.com',
      '/api': process.env.VITE_API_BASE || 'https://cuex-backend.onrender.com',
      '/download': process.env.VITE_API_BASE || 'https://cuex-backend.onrender.com',
    }
  }
})
