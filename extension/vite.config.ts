import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit:false,
    rollupOptions: {
      input: {
        popup:'popup.html',
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
      targets: [
        { src: 'manifest.json', dest: '.' },
        { src: 'icons/*.png', dest: 'icons' }
      ]
    }),
    tailwindcss()
  ],
});