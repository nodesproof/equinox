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
  build: {
    outDir: path.resolve(ROOT, 'dist'), emptyOutDir: true, target: 'es2022', sourcemap: false,
    // Dua chunk vendor statis (viem + dependensinya, React + router) agar chunk aplikasi kecil dan cache vendor bertahan antar deploy;
    // semuanya tetap dimuat di awal (modulepreload) — bukan lazy — sehingga anggaran 250 KB gzip `scripts/size.mjs` tetap menghitung semuanya.
    rollupOptions: { output: { manualChunks(id) {
      if (/node_modules\/(viem|ox|abitype|isows|@noble\/[^/]+|@scure\/[^/]+)\//.test(id)) return 'viem';
      if (/node_modules\/(react|react-dom|scheduler|use-sync-external-store|wouter|regexparam)\//.test(id)) return 'react';
      return undefined;
    } } },
  },
});
