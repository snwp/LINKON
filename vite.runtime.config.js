import { defineConfig } from 'vite';

// Gera src-tauri/runtime/linkon.js: o script do site exportado (anima e desenha o 3D), com three embutido.
// O arquivo gerado é versionado porque o Rust o embute com include_str! (ver site.rs).
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'src-tauri/runtime',
    emptyOutDir: false,
    minify: true,
    target: 'es2020',
    lib: { entry: 'src/lib/runtime/page.ts', name: 'Linkon', formats: ['iife'], fileName: () => 'linkon.js' },
  },
});
