import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  // Relative asset paths, so the same build works at / (dev) and /openspace-vj-controls/ (GitHub Pages).
  base: './',
  server: {
    // Web MIDI needs a secure context; localhost counts as one.
    host: 'localhost',
    port: 5173,
  },
});
