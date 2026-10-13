import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
export default defineConfig({
  root: path('./'),
  base: './',
  publicDir: path('../static'),
  plugins: [svelte({ configFile: false })],
  resolve: {
    alias: { $lib: path('../src/lib'), '$app/forms': path('./forms.ts'), '$app/navigation': path('./navigation.ts') }
  },
  build: { outDir: path('../dist-browser'), emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5175, fs: { allow: [path('../')] } },
  preview: { host: '127.0.0.1', port: 5175 }
});
