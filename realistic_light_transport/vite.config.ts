import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Relative base so the built app works from any GitHub Pages project subpath.
  base: './',
  plugins: [react()],
  server: {
    fs: { allow: ['..'] },
  },
})
