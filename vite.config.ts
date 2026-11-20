import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  server: {
    // Web MIDI needs a secure context; localhost counts as one.
    host: 'localhost',
    port: 5173,
  },
});
