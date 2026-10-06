import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {createConnection} from 'node:net';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {marked} from 'marked';

const serverEntry = resolve('dist/server/server.mjs');
if (!existsSync(serverEntry)) throw new Error('Build the app first with npm run build');

const firstPort = Number(process.env.PORT_BASE ?? '42031');
if (!Number.isInteger(firstPort) || firstPort < 1 || firstPort > 65534) {
  throw new Error('PORT_BASE must leave room for two TCP ports');
}

const count = 50_000;
const attributeText = Array.from({length: count}, (_, index) => ` a${index}="x"`).join('');
const distinct = `<div${attributeText}>x</div>`;
const duplicateBase = `<div${' a="x"'.repeat(count)}>x</div>`;
const inputs = {
  distinct,
  text: `<div>${'x'.repeat(Buffer.byteLength(distinct) - 11)}</div>`,
  duplicate: duplicateBase.replace(
    '>x</div>',
    `>${'x'.repeat(Buffer.byteLength(distinct) - Buffer.byteLength(duplicateBase) + 1)}</div>`,
  ),
};
assert.ok(Buffer.byteLength(distinct) < 1024 * 1024);
assert.ok(Object.values(inputs).every((input) => Buffer.byteLength(input) === Buffer.byteLength(distinct)));

const runRoot = resolve('runs', new Date().toISOString().replaceAll(':', '-'));
mkdirSync(runRoot, {recursive: true});

async function waitForPort(port, worker) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const ready = await new Promise((done) => {
      const socket = createConnection({host: '127.0.0.1', port});
      socket.once('connect', () => {socket.destroy(); done(true);});
      socket.once('error', () => {socket.destroy(); done(false);});
    });
    if (ready) return;
    if (worker.exitResult) throw new Error(`server ${port} exited: ${JSON.stringify(worker.exitResult)}`);
    await delay(50);
  }
  throw new Error(`server ${port} did not listen`);
}

async function timedRequest(port, path, options = {}) {
  const start = performance.now();
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...options,
    signal: AbortSignal.timeout(120_000),
  });
  const body = await response.text();
  return {
    port, path, status: response.status,
    elapsedMs: Math.round(performance.now() - start),
    responseBytes: Buffer.byteLength(body),
    responseSha256: createHash('sha256').update(body).digest('hex'),
    sanitizedDiv: body.includes('<article><div>x</div></article>'),
    lastRawAttribute: body.includes('a49999="x"'),
  };
}

function startWorker(port, directory) {
  const child = spawn(process.execPath, [serverEntry], {
    cwd: directory,
    env: {...process.env, PORT: String(port)},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const worker = {port, child, log: '', exitResult: null};
  child.stdout.on('data', (chunk) => worker.log += chunk);
  child.stderr.on('data', (chunk) => worker.log += chunk);
  worker.exited = new Promise((done) => child.once('exit', (code, signal) => {
    worker.exitResult = {code, signal};
    done(worker.exitResult);
  }));
  return worker;
}

async function runCase(label, shape, workerCount) {
  const directory = resolve(runRoot, label);
  mkdirSync(directory);
  const input = inputs[shape];
  writeFileSync(resolve(directory, 'submitted.md'), input);
  const markedStart = performance.now();
  const parsed = marked.parse(input);
  const result = {
    label, shape, workerCount, node: process.version,
    platform: `${process.platform} ${process.arch}`,
    inputBytes: Buffer.byteLength(input),
    inputSha256: createHash('sha256').update(input).digest('hex'),
    markedMs: Math.round(performance.now() - markedStart),
    markedPreserved: parsed.trim() === input.trim(),
  };
  const ports = workerCount === 1 ? [firstPort] : [firstPort, firstPort + 1];
  const workers = ports.map((port) => startWorker(port, directory));
  let failure;
  try {
    await Promise.all(workers.map((worker) => waitForPort(worker.port, worker)));
    result.beforeSubmit = await timedRequest(ports[0], '/article');
    result.submission = await timedRequest(ports[0], '/submit', {
      method: 'POST', headers: {'content-type': 'text/markdown'}, body: input,
    });
    const articleRequests = ports.map((port) => timedRequest(port, '/article'));
    await delay(2_000);
    const benignRequests = ports.map((port) => timedRequest(port, '/submit', {
      method: 'POST', headers: {'content-type': 'text/markdown'}, body: 'benign',
    }));
    result.articles = await Promise.all(articleRequests);
    result.benignPosts = await Promise.all(benignRequests);
  } catch (error) {
    result.error = String(error);
    failure = error;
  } finally {
    result.workerExit = await Promise.all(workers.map(async (worker) => {
      worker.child.kill('SIGTERM');
      let exited = await Promise.race([worker.exited, delay(3_000).then(() => null)]);
      if (!exited) {worker.child.kill('SIGKILL'); exited = await worker.exited;}
      writeFileSync(resolve(directory, `worker-${worker.port}.log`), worker.log);
      return {port: worker.port, ...exited};
    }));
    writeFileSync(resolve(directory, 'summary.json'), JSON.stringify(result, null, 2) + '\n');
  }
  console.log(JSON.stringify(result));
  if (failure) throw failure;
  return result;
}

const cases = [
  ['same-size-text', 'text', 1],
  ['same-size-duplicate-attributes', 'duplicate', 1],
  ['distinct-attributes-first-worker', 'distinct', 1],
  ['distinct-attributes-second-worker', 'distinct', 1],
  ['same-size-text-two-workers', 'text', 2],
  ['distinct-attributes-two-workers', 'distinct', 2],
];
const results = [];
for (const [label, shape, workerCount] of cases) results.push(await runCase(label, shape, workerCount));

let verdict = 'PASS';
let assertionError;
try {
  const [text, duplicate, first, second, textPool, distinctPool] = results;
  for (const run of results) {
    assert.equal(run.markedPreserved, true);
    assert.equal(run.inputBytes, text.inputBytes);
    assert.equal(run.submission.status, 201);
    assert.ok(run.articles.every((article) => article.status === 200));
    assert.ok(run.benignPosts.every((post) => post.status === 201));
    assert.ok(run.workerExit.every((worker) => worker.signal === 'SIGTERM'));
  }
  for (const run of [first, second, distinctPool]) {
    assert.ok(run.articles.every((article) => article.sanitizedDiv && !article.lastRawAttribute));
    assert.ok(run.articles.every((article) => article.elapsedMs > Math.max(1_000, text.articles[0].elapsedMs * 5)));
    assert.ok(run.benignPosts.every((post) => post.elapsedMs > Math.max(500, text.benignPosts[0].elapsedMs * 5)));
  }
  assert.ok(duplicate.articles[0].elapsedMs < first.articles[0].elapsedMs / 5);
  assert.ok(textPool.articles.every((article) => article.elapsedMs < distinctPool.articles[0].elapsedMs / 5));
  assert.ok(textPool.benignPosts.every((post) => post.elapsedMs < distinctPool.benignPosts[0].elapsedMs / 5));
} catch (error) {
  verdict = 'FAIL';
  assertionError = String(error);
}
writeFileSync(resolve(runRoot, 'verdict.json'), JSON.stringify({verdict, assertionError, runRoot, cases: cases.map(([label]) => label)}, null, 2) + '\n');
if (verdict === 'FAIL') throw new Error(`Reproduction assertions failed: ${assertionError}. Logs: ${runRoot}`);
console.log(`PASS: distinct attribute parsing delayed valid requests on one and two workers; controls were prompt. Logs: ${runRoot}`);
