/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
  server: {
    host: '0.0.0.0',
    // Dev server only: lets local ngrok URLs reach Vite without affecting production builds.
    allowedHosts: ['frontend', '.ngrok-free.app', '.ngrok-free.dev'],
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://localhost:8721',
        changeOrigin: true,
      },
    },
  },
})
