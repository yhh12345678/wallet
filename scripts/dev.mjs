import './build.mjs';
import { createServer } from 'node:http';
import { localDb } from './local-db.mjs';

const app = (await import('../dist/server/index.js')).default;
const DB = localDb('.wallet-local.sqlite');
const argument = (flag) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
};
const port = Number(argument('--port') ?? process.env.PORT ?? 5173);
const host = argument('--host') ?? '127.0.0.1';

createServer(async (incoming, outgoing) => {
  const address = new URL(incoming.url, 'http://' + incoming.headers.host);
  const chunks = [];
  for await (const chunk of incoming) chunks.push(chunk);
  const headers = new Headers(incoming.headers);
  const user = address.searchParams.get('devUser') === 'guest' || headers.get('cookie')?.includes('wallet_dev=guest') ? 'guest' : 'owner';
  headers.set('oai-authenticated-user-id', 'local-' + user);
  headers.set('oai-authenticated-user-full-name', encodeURIComponent(user === 'guest' ? '本地成员' : '本地创建者'));
  headers.set('oai-authenticated-user-full-name-encoding', 'percent-encoded-utf-8');
  const request = new Request(address, {
    headers,
    method: incoming.method,
    body: ['GET', 'HEAD'].includes(incoming.method) ? undefined : Buffer.concat(chunks),
  });
  try {
    const result = await app.fetch(request, { DB });
    const responseHeaders = Object.fromEntries(result.headers);
    if (address.searchParams.has('devUser')) responseHeaders['Set-Cookie'] = 'wallet_dev=' + user + '; Path=/; SameSite=Lax';
    outgoing.writeHead(result.status, responseHeaders);
    outgoing.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    console.error(error);
    outgoing.writeHead(500).end();
  }
}).listen(port, host, () => console.log('Local http://localhost:' + port));
