import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const publicDir = resolve(root, 'public');
const output = resolve(root, 'dist/render');
const key = process.env.WALLET_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
let url;
try { url = new URL(process.env.WALLET_SUPABASE_URL); } catch {
  throw new Error('Set WALLET_SUPABASE_URL to the Supabase project URL.');
}
const local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
if ((!local && url.protocol !== 'https:') || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
  throw new Error('WALLET_SUPABASE_URL must be an HTTPS project origin or a local HTTP origin.');
}
let isAnonKey = false;
if (/^[\w-]+\.[\w-]+\.[\w-]+$/.test(key)) {
  try { isAnonKey = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role === 'anon'; } catch { /* Invalid JWT. */ }
}
if (!/^sb_publishable_[\w-]+$/.test(key) && !isAnonKey) {
  throw new Error('Set WALLET_SUPABASE_PUBLISHABLE_KEY to a publishable or legacy anon key.');
}

await mkdir(output, { recursive: true });
const policy = `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src ${url.origin}; font-src 'self'; base-uri 'none'; form-action 'self'`;
const index = await readFile(resolve(publicDir, 'index.html'), 'utf8');
await Promise.all([
  writeFile(resolve(output, 'index.html'), index.replace('<meta charset="utf-8">', '$&\n  <meta http-equiv="Content-Security-Policy" content="' + policy + '">')),
  copyFile(resolve(publicDir, 'style.css'), resolve(output, 'style.css')),
  build({
    entryPoints: [resolve(publicDir, 'app.js')],
    outfile: resolve(output, 'app.js'),
    bundle: true,
    format: 'esm',
    minify: true,
    define: {
      WALLET_SUPABASE_URL: JSON.stringify(url.origin),
      WALLET_SUPABASE_PUBLISHABLE_KEY: JSON.stringify(key),
    },
    plugins: [{
      name: 'wallet-render',
      setup(builder) {
        builder.onResolve({ filter: /^\.\/(backend|model)\.js$/ }, args => {
          if (args.resolveDir !== publicDir) return;
          return { path: resolve(root, args.path === './backend.js' ? 'render/backend.js' : 'supabase/functions/_shared/model.js') };
        });
      },
    }],
  }),
]);
