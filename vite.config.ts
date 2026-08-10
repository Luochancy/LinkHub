import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'

export default defineConfig({
  plugins: [vue(), vuetify({ autoImport: true })],
  publicDir: 'static',
  build: { outDir: 'public' },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } }
})
