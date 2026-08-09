import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Workspace packages are consumed as source, not prebundled deps.
  optimizeDeps: {
    exclude: ['@saro/shared', '@saro/ui', 'maplibre-gl'],
  },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('leaflet') || id.includes('react-leaflet')) return 'vendor-leaflet';
            if (id.includes('@turf')) return 'vendor-turf';
            if (id.includes('lucide-react')) return 'vendor-icons';
            if (id.includes('react')) return 'vendor-react';
            return 'vendor';
          }
        },
      },
    },
  },
});
