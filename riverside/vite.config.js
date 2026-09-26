import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootSrc = path.resolve(__dirname, '../src')

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    alias: {
      '@culin': rootSrc,
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    open: true,
    fs: {
      // Allow importing Nestlé src + data assets from the parent tree.
      allow: [path.resolve(__dirname, '..')],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
    env: {
      VITE_API_BASE: process.env.CULIN_API || 'http://127.0.0.1:8001',
      VITE_OPENAI_API_KEY: process.env.VITE_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '',
      VITE_OPENAI_MODEL: process.env.VITE_OPENAI_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
    },
  },
})
