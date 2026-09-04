import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';
import { handleCacheRequest, startBackgroundJobs } from './server/index.js';

function readGitValue(args, fallback) {
  try {
    return execFileSync('git', args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim() || fallback;
  } catch {
    return fallback;
  }
}

export function getAppVersionMetadata(env = process.env) {
  return {
    version: env.APP_VERSION || readGitValue(['rev-parse', '--short', 'HEAD'], 'unknown'),
    updated: env.APP_UPDATED_DATE || readGitValue(['show', '-s', '--date=format:%Y-%m-%d %H:%M:%S', '--format=%cd', 'HEAD'], 'unknown')
  };
}

function appVersionPlugin() {
  return {
    name: 'stock-monitor-app-version',
    transformIndexHtml(html) {
      const metadata = getAppVersionMetadata();
      return html
        .replaceAll('__APP_GIT_VERSION__', metadata.version)
        .replaceAll('__APP_UPDATED_DATE__', metadata.updated);
    }
  };
}

function cacheApiPlugin() {
  return {
    name: 'stock-monitor-cache-api',
    configureServer(server) {
      startBackgroundJobs();
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/cache')) {
          next();
          return;
        }
        handleCacheRequest(req, res).catch(next);
      });
    }
  };
}

function attachProxyErrorHandler(proxy) {
  proxy.on('error', (err, _req, res) => {
    if (res && !res.headersSent) {
      if (typeof res.writeHead === 'function') {
        res.writeHead(502, { 'Content-Type': 'application/json' });
      }
      if (typeof res.end === 'function') {
        res.end(JSON.stringify({ error: 'Proxy upstream unavailable', message: err && err.message }));
      }
    }
  });
}

export default defineConfig({
  plugins: [appVersionPlugin(), cacheApiPlugin()],
  server: {
    port: 5173,
    open: false,
    host: '127.0.0.1',
    watch: {
      ignored: ['**/data/cache/**']
    },
    proxy: {
      '/api/tencent': {
        target: 'https://qt.gtimg.cn',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/tencent/, ''),
        configure: (proxy) => {
          attachProxyErrorHandler(proxy);
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
          });
        }
      },
      // NOTE: '/api/eastmoney-kline' MUST be declared BEFORE '/api/eastmoney'
      // because vite proxy matches by object-key insertion order (first startsWith wins).
      // See node_modules/vite/dist/node/chunks/dep-*.js doesProxyContextMatchUrl + viteProxyMiddleware.
      '/api/eastmoney-kline': {
        target: 'https://push2his.eastmoney.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/eastmoney-kline/, '/api'),
        configure: (proxy) => {
          attachProxyErrorHandler(proxy);
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Referer', 'https://quote.eastmoney.com/');
            proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
          });
        }
      },
      '/api/eastmoney': {
        target: 'https://push2.eastmoney.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/eastmoney/, '/api'),
        configure: (proxy) => {
          attachProxyErrorHandler(proxy);
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Referer', 'https://quote.eastmoney.com/');
            proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            proxyReq.setHeader('Accept', '*/*');
          });
        }
      },
      // '/api/limit-up' MUST be declared AFTER '/api/eastmoney' but before '/api/sina'
      // (longer prefixes must come first per vite key-insertion-order match).
      '/api/limit-up': {
        target: 'https://push2.eastmoney.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/limit-up/, '/api'),
        configure: (proxy) => {
          attachProxyErrorHandler(proxy);
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Referer', 'https://quote.eastmoney.com/');
            proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            proxyReq.setHeader('Accept', '*/*');
          });
        }
      },
      // '/api/limit-up-stock' MUST be declared AFTER '/api/limit-up' (longer prefix wins first).
      // Per-stock metadata fetcher (f100/f102/f103 = 连板数/封板时间/炸板次数).
      '/api/limit-up-stock': {
        target: 'https://push2.eastmoney.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/limit-up-stock/, '/api'),
        configure: (proxy) => {
          attachProxyErrorHandler(proxy);
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Referer', 'https://quote.eastmoney.com/');
            proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            proxyReq.setHeader('Accept', '*/*');
          });
        }
      },
      // AKTools (AKShare HTTP proxy) — local Python backend on port 8888.
      // Path format: /api/aktools/api/public/{interface_name}?{params}
      //   e.g. /api/aktools/api/public/stock_zt_pool_em
      //        /api/aktools/api/public/stock_zt_pool_zbgc_em
      // No Referer/User-Agent needed (local backend, not anti-scraped).
      // To change port, update both this `target` and the user's aktools startup script.
      '/api/aktools': {
        target: 'http://127.0.0.1:8888',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/aktools/, ''),
        configure: (proxy) => {
          attachProxyErrorHandler(proxy);
        }
      },
      '/api/sina': {
        target: 'https://hq.sinajs.cn',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/sina/, ''),
        configure: (proxy) => {
          attachProxyErrorHandler(proxy);
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Referer', 'https://finance.sina.com.cn/');
            proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
          });
        }
      },
      // Tencent kline fallback (used when Eastmoney is rate-limited / returns 5xx).
      // NOTE: '/api/qq-kline-min' MUST be declared BEFORE '/api/qq-kline' (vite key-insertion-order match).
      '/api/qq-kline-min': {
        target: 'https://ifzq.gtimg.cn',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/qq-kline-min/, ''),
        configure: (proxy) => {
          attachProxyErrorHandler(proxy);
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Referer', 'https://gu.qq.com/');
            proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
          });
        }
      },
      '/api/qq-kline': {
        target: 'https://web.ifzq.gtimg.cn',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/qq-kline/, ''),
        configure: (proxy) => {
          attachProxyErrorHandler(proxy);
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Referer', 'https://gu.qq.com/');
            proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
          });
        }
      }
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    minify: 'terser',
    chunkSizeWarningLimit: 600,
    terserOptions: {
      compress: {
        pure_funcs: ['console.log', 'console.debug', 'console.info'],
        drop_debugger: true
      },
      mangle: { toplevel: false }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true
  }
});
