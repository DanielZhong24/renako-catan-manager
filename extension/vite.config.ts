import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        content: 'src/content.ts',
      },
      output: {
        // This forces the file to be named exactly content.js
        entryFileNames: '[name].js', 
        assetFileNames: '[name].[ext]',
        chunkFileNames: '[name].js',
      },
    },
  },
  plugins: [
    viteStaticCopy({
      targets: [{ src: 'manifest.json', dest: '.' }]
    }),
  ],
});