import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

/**
 * Social networks and search engines need absolute URLs for og:image, og:url and
 * canonical, and they read the HTML without running JavaScript. Replace %SITE_URL%
 * in index.html with the site's address:
 *   1. VITE_SITE_URL, if set (e.g. https://snipline.app)
 *   2. on Vercel, the project's production domain (set automatically at build)
 *   3. on Render, the service's public URL (set automatically at build)
 *   4. the dev server address while developing
 *   5. otherwise the Render address the app is published at
 * A relative URL here makes Facebook, LINE and LinkedIn show a blank preview image.
 */
const DEFAULT_SITE_URL = 'https://cloudcut-frontend.onrender.com';
function siteUrlPlugin(mode) {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    name: 'site-url',
    transformIndexHtml(html, ctx) {
      const fromEnv = env.VITE_SITE_URL || process.env.VITE_SITE_URL;
      const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
      const render = process.env.RENDER_EXTERNAL_URL;
      const devUrl = ctx.server ? `http://localhost:${ctx.server.config.server.port ?? 5173}` : '';
      const siteUrl = (fromEnv || (vercel ? `https://${vercel}` : '') || render || devUrl || DEFAULT_SITE_URL).replace(/\/+$/, '');
      return html.replaceAll('%SITE_URL%', siteUrl);
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), siteUrlPlugin(mode)],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        // Keep rarely-changing libraries in their own long-cacheable files.
        // pusher-js is only imported by the editor, so it stays out of the first load.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (id.includes('pusher-js')) return 'realtime';
          return undefined;
        }
      }
    }
  }
}));
