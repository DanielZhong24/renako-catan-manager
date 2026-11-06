import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import tailwindcss from '@tailwindcss/vite';

// Backend/bot-service URLs are fixed per build, not per user.
//   npm run dev   -> --mode development -> local Docker stack
//   npm run build -> production         -> the published release
const TARGETS = {
  development: {
    apiBaseUrl: 'http://localhost:3000',
    botServiceUrl: 'http://localhost:8000',
  },
  production: {
    apiBaseUrl: 'https://amaori-renako.com',
    // Empty = the extension does not call the catan-clanker service.
    // Set to its public HTTPS URL once it is deployed.
    botServiceUrl: '',
  },
};

export default defineConfig(({ mode }) => {
  const target = mode === 'development' ? TARGETS.development : TARGETS.production;
  return {
    define: {
      __API_BASE_URL__: JSON.stringify(target.apiBaseUrl),
      __BOT_SERVICE_URL__: JSON.stringify(target.botServiceUrl),
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      cssCodeSplit: false,
      rollupOptions: {
        input: {
          popup: 'popup.html',
          content: 'src/content.ts',
          recorder: 'src/recorder.ts',
          background: 'src/background.ts',
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
  };
});
