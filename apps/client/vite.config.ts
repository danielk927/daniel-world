import { resolve } from 'node:path';
import { defineConfig, runnerImport, type Plugin, type ViteDevServer } from 'vite';
import type * as PortfolioPage from './src/portfolioPage.ts';

const PAGE_MODULE = '/src/portfolioPage.ts';

/**
 * Writes the portfolio into portfolio.html from content.ts, so the page is whole before any script
 * runs: it reads with JavaScript off, and search engines and link previews see all of it. The page
 * module imports the dish photos, which only Vite can load, so Vite runs it: the dev server itself
 * while developing, and in a build `runnerImport`, which runs one module without a config of its
 * own or a dev server, so nothing touches the dependency cache a dev server may be using. The photos
 * come out as /src paths, which the build then bundles like any image in a page.
 */
function portfolioPage(): Plugin {
  let dev: ViteDevServer | undefined;
  const load = async (): Promise<typeof PortfolioPage> => {
    if (dev) return (await dev.ssrLoadModule(PAGE_MODULE)) as typeof PortfolioPage;
    const { module } = await runnerImport<typeof PortfolioPage>(PAGE_MODULE, {
      root: import.meta.dirname,
      logLevel: 'error',
    });
    return module;
  };
  return {
    name: 'portfolio-page',
    configureServer(server) {
      dev = server;
      // The open page is written from what it imports: show it again when any of that changes.
      server.watcher.on('change', (file) => {
        if (server.environments.ssr.moduleGraph.getModulesByFile(file)?.size) {
          server.ws.send({ type: 'full-reload', path: '/portfolio.html' });
        }
      });
    },
    transformIndexHtml: {
      order: 'pre',
      async handler(html, { path }) {
        if (path !== '/portfolio.html') return html;
        return (await load()).renderPortfolio(html);
      },
    },
  };
}

export default defineConfig({
  plugins: [portfolioPage()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: {
    target: 'es2022',
    // three.js is ~580 kB minified on its own; it is lazy-loaded after the landing UI.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        portfolio: resolve(import.meta.dirname, 'portfolio.html'),
      },
    },
  },
});
