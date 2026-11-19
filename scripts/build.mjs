import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const type = { html: 'text/html', css: 'text/css', js: 'text/javascript' };
const model = await readFile(resolve(root, 'supabase/functions/_shared/model.js'), 'utf8');
const assets = { '/model.js': { type: 'text/javascript; charset=utf-8', body: model } };
for (const filename of await readdir(resolve(root, 'public'))) {
  const ext = filename.split('.').at(-1);
  if (!Object.hasOwn(type, ext)) continue;
  assets['/' + filename] = {
    type: type[ext] + '; charset=utf-8',
    body: await readFile(resolve(root, 'public', filename), 'utf8'),
  };
}
const output = resolve(root, 'dist/server');
await mkdir(output, { recursive: true });
const server = await readFile(resolve(root, 'server/index.js'), 'utf8');
const source = model + '\nconst assets = ' + JSON.stringify(assets) + ';\n' + server.replace(/^import .*;\n/gm, '');
await writeFile(resolve(output, 'index.js'), source);
