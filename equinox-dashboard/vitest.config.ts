import path from 'node:path';
import { defineConfig } from 'vitest/config';
const ROOT = path.resolve(import.meta.dirname);
export default defineConfig({
  resolve: { alias: { '@': path.resolve(ROOT, 'client', 'src'), '@chain': path.resolve(ROOT, '..', 'web', 'src'), '@deployment': path.resolve(ROOT, '..', 'deployments', 'arbitrum-sepolia.json') } },
  define: { __COMMIT__: '"test"', __BUILD_TIME__: '"1970-01-01T00:00:00.000Z"', 'import.meta.env.BASE_URL': '"/equinox/"' },
  test: { environment: 'jsdom', setupFiles: ['test/setup.ts'], include: ['test/**/*.test.tsx', 'test/**/*.test.ts'], css: false },
});
