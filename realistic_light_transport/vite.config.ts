import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { specimenStudioService } from './src/specimens/specimenStudioService'
import { candidateCatalogService } from './src/workbench/candidateCatalogService'

export default defineConfig({
  // Relative base so the built app works from any GitHub Pages project subpath.
  base: './',
  // The service worker consumes this build-owned inventory during installation so the
  // hashed bundle, GLB specimens, and textures are available on the first offline launch.
  build: { manifest: 'asset-manifest.json' },
  plugins: [react(), specimenStudioService(), candidateCatalogService()],
  server: {
    host: '127.0.0.1',
    fs: { allow: ['..'] },
  },
})
