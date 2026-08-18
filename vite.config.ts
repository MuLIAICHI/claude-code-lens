import { defineConfig } from 'vite';

// Build the web/ frontend into web/dist. `base: './'` keeps asset URLs relative
// so the Node server can serve them from any path. No external CDN/asset hosts.
export default defineConfig({
  root: 'web',
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
