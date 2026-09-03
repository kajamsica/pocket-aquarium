import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { specimenStudioService } from './src/specimens/specimenStudioService'

export default defineConfig({
  // Relative base so the built app works from any GitHub Pages project subpath.
  base: './',
  plugins: [react(), specimenStudioService()],
  server: {
    host: '127.0.0.1',
    fs: { allow: ['..'] },
  },
})
