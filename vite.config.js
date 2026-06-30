import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  base: '/',
  server: {
    host: true,
    proxy: {
      '/api': 'http://127.0.0.1:6001'
    }
  }
}))
