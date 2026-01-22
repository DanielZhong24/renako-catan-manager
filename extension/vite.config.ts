import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        content: 'src/content.ts',
        background: 'src/background.ts', // <--- ADD THIS LINE
      },
      output: {
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