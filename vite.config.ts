import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from 'vite-plugin-pwa';
import { visualizer } from 'rollup-plugin-visualizer';


// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'robots.txt', '*.png', '*.svg'],
      manifest: {
        name: 'VALNIX - Loja de Games',
        short_name: 'VALNIX',
        description: 'A melhor loja de moedas virtuais e itens de jogos',
        theme_color: '#EE4444',
        background_color: '#000000',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      injectManifest: {
        // Precache only the shell — index, entry JS chunk, query/vendor chunks,
        // CSS, fonts, favicons. Admin/AdminAnalytics/AdminCategories/etc. are
        // intentionally excluded so visitors don't pre-download ~2.5 MB of code
        // they'll never use. Lazy chunks come down on-demand and the SW cache
        // policies in src/sw.ts handle them at runtime.
        globPatterns: [
          'index.html',
          'manifest.webmanifest',
          'assets/index-*.css',
          'assets/js/index-*.js',
          'assets/js/vendor-*.js',
          'assets/js/query-*.js',
          'assets/poppins-*.{woff,woff2}',
          'assets/*.css',
          'favicon.*',
          'icon-*.png',
        ],
        globIgnores: [
          'assets/js/Admin*.js',
          'assets/js/admin*.js',
          'assets/js/recharts*.js',
          'assets/js/ImageUploader*.js',
          'assets/js/CategoryManager*.js',
        ],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB
      },
    }),
    mode === 'production' && visualizer({
      filename: 'dist/bundle-report.html',
      open: false,
      gzipSize: true,
      brotliSize: true,
      template: 'treemap',
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['react', 'react-dom', 'react-router-dom'],
          'query': ['@tanstack/react-query'],
          // Radix, charts, carousel: NOT in manualChunks so Vite only loads
          // them when actually imported by a route.
        },
        assetFileNames: (assetInfo) => {
          if (!assetInfo.name) return 'assets/[name]-[hash][extname]';
          const info = assetInfo.name.split('.');
          const ext = info[info.length - 1];
          if (/png|jpe?g|svg|gif|tiff|bmp|ico|webp|avif/i.test(ext)) {
            return `assets/images/[name]-[hash][extname]`;
          }
          return `assets/[name]-[hash][extname]`;
        },
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
      }
    },
    chunkSizeWarningLimit: 1000,
    minify: 'esbuild',
    reportCompressedSize: false,
    target: 'es2020',
    cssMinify: true,
    modulePreload: {
      // Only preload chunks that are directly imported (not lazy chunks)
      resolveDependencies: (_filename, deps) => {
        return deps.filter(dep =>
          !dep.includes('charts') &&
          !dep.includes('carousel') &&
          !dep.includes('Admin') &&
          !dep.includes('recharts') &&
          !dep.includes('autoplay') &&
          !dep.includes('embla')
        );
      },
    },
  }
}));