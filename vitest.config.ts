import { defineConfig } from 'vitest/config';

// Core tests run in plain Node: src/core must not need a DOM.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
