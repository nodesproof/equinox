import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { defineConfig } from 'vite';

// Data layer = ../web/src (alias @chain); manifest = ../deployments (alias @deployment) — satu sumber alamat, tanpa duplikasi logika chain.
const ROOT = path.resolve(import.meta.dirname);
const WEB = path.resolve(ROOT, '..', 'web', 'src');
const MANIFEST = path.resolve(ROOT, '..', 'deployments', 'arbitrum-sepolia.json');
function commit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'dev'; }
}
export default defineConfig({
  base: '/equinox/',
  root: path.resolve(ROOT, 'client'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(ROOT, 'client', 'src'), '@chain': WEB, '@deployment': MANIFEST },
    dedupe: ['viem', 'react', 'react-dom'],
  },
  define: { __COMMIT__: JSON.stringify(commit()), __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  server: { fs: { allow: [ROOT, WEB, path.dirname(MANIFEST)] } },
  build: { outDir: path.resolve(ROOT, 'dist'), emptyOutDir: true, target: 'es2022', sourcemap: false },
});
