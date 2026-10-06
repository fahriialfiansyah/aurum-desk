import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**'],
    setupFiles: ['test/setup.ts'],
    css: false,
    coverage: { provider: 'v8', include: ['src/**'], exclude: ['src/chart/use-chart.ts', 'src/components/ChartCanvas.tsx'] },
  },
});
