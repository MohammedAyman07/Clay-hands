import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

function mediapipeWasmPlugin(): Plugin {
  const pkgWasmDir = path.resolve(
    process.cwd(),
    'node_modules/@mediapipe/tasks-vision/wasm'
  );
  const publicWasmDir = path.resolve(process.cwd(), 'public/mediapipe/wasm');

  const resolveWasmAsset = (fileName: string): string | null => {
    const safeName = path.basename(fileName);
    const inPublic = path.join(publicWasmDir, safeName);
    if (fs.existsSync(inPublic) && fs.statSync(inPublic).isFile()) {
      return inPublic;
    }
    const inPkg = path.join(pkgWasmDir, safeName);
    if (fs.existsSync(inPkg) && fs.statSync(inPkg).isFile()) {
      return inPkg;
    }
    return null;
  };

  return {
    name: 'mediapipe-wasm-mime-and-fallback',
    configureServer(server) {
      server.middlewares.use('/mediapipe/wasm', (req, res, next) => {
        const cleanUrl = (req.url ?? '').split('?')[0];
        const fileName = cleanUrl.replace(/^\/+/, '');
        if (!fileName || fileName.includes('/')) {
          return next();
        }
        const resolved = resolveWasmAsset(fileName);
        if (!resolved) {
          res.statusCode = 404;
          res.end('WASM asset not found');
          return;
        }
        if (fileName.endsWith('.wasm')) {
          res.setHeader('Content-Type', 'application/wasm');
        } else if (fileName.endsWith('.js')) {
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        }
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        const stat = fs.statSync(resolved);
        res.setHeader('Content-Length', String(stat.size));
        if (req.method === 'HEAD') {
          res.statusCode = 200;
          res.end();
          return;
        }
        fs.createReadStream(resolved).pipe(res);
      });
    },
    closeBundle() {
      const distWasmDir = path.resolve(process.cwd(), 'dist/mediapipe/wasm');
      if (!fs.existsSync(pkgWasmDir) || !fs.existsSync(path.resolve(process.cwd(), 'dist'))) {
        return;
      }
      fs.mkdirSync(distWasmDir, { recursive: true });
      for (const entry of fs.readdirSync(pkgWasmDir)) {
        const src = path.join(pkgWasmDir, entry);
        const dest = path.join(distWasmDir, entry);
        if (fs.statSync(src).isFile() && !fs.existsSync(dest)) {
          fs.copyFileSync(src, dest);
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [mediapipeWasmPlugin()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
    hmr: false,
  },
});
