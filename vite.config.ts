import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: 'src/webview/index.html',
      output: {
        entryFileNames: 'webview/[name].js',
        chunkFileNames: 'webview/[name].js',
        assetFileNames: 'webview/[name].[ext]'
      }
    }
  }
}); 