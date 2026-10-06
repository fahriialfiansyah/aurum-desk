import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: { provider: 'v8', include: ['src/**'], exclude: ['src/main.ts', 'src/scheduler.ts', 'src/providers/dukascopy.ts'] },
  },
});
