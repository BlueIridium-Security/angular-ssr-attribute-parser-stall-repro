// @ts-nocheck -- this test fixture does not install @types/node.
import {createServer} from 'node:http';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {marked} from 'marked';
import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';

const engine = new AngularNodeAppEngine();
const articlePath = 'article.md';

export const reqHandler = createNodeRequestHandler((request, response) => {
  if (request.method === 'POST' && request.url === '/submit') {
    if (request.headers['content-type'] !== 'text/markdown') {
      response.writeHead(415).end('expected Markdown');
      return;
    }
    const chunks: Buffer[] = [];
    let length = 0;
    request.on('data', (chunk: Buffer) => {
      length += chunk.length;
      if (length > 1024 * 1024) request.destroy();
      else chunks.push(chunk);
    });
    request.on('end', () => {
      writeFileSync(articlePath, Buffer.concat(chunks));
      response.writeHead(201, {'Content-Type': 'text/plain'}).end('stored');
    });
    return;
  }

  const content = existsSync(articlePath) ? marked.parse(readFileSync(articlePath, 'utf8')) : '';
  engine.handle(request, {content})
    .then((webResponse) => {
      if (webResponse) return writeResponseToNodeResponse(webResponse, response);
      response.writeHead(404).end();
    })
    .catch((error) => {
      console.error(error);
      response.writeHead(500).end();
    });
});

if (isMainModule(import.meta.url)) {
  const port = Number(process.env.PORT ?? '41856');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid PORT');
  createServer(reqHandler).listen(port, '127.0.0.1');
}
