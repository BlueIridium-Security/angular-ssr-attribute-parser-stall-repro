# Angular SSR attribute parser worker-stall reproduction

This standalone Angular SSR app accepts an unauthenticated Markdown article. Marked preserves raw HTML, and the article page renders it through an ordinary `[innerHTML]` binding. A 539 KB article with one `<div>` and 50,000 distinct attributes makes the server-side HTML parser repeatedly scan preceding attribute names. While the article renders, the Node.js worker cannot promptly answer another valid request. The worker survives and Angular strips the unknown attributes from its response.

The app uses released Angular 22.2.0 packages, Marked 18.0.11, and a 1 MiB submission limit. It uses `AngularNodeAppEngine` normally, with no sanitizer bypass or framework patch. Critical CSS inlining is disabled through a supported build option to isolate the HTML parser path.

## Run

With Docker:

```sh
docker build -t angular-ssr-attribute-parser-stall .
docker run --rm angular-ssr-attribute-parser-stall
```

Or with Node 24.19.0 or later in the 24.x line and npm:

```sh
npm ci
npm run build
npm run validate
```

The validator starts fresh production servers, submits each article with `POST /submit`, and requests `GET /article`. Two seconds after each article request starts, it sends a valid, small `POST /submit` to measure whether that worker can serve unrelated application traffic. It tests exactly byte-matched plain HTML text and duplicate-attribute controls, two fresh single-worker distinct-attribute runs, and a two-worker pool with matched controls. It writes the submitted inputs, response summaries, worker logs, and a verdict under ignored `runs/`. Timings vary by machine; assertions use broad relative thresholds. Set `PORT_BASE` if the default local ports 42031–42032 are occupied.

## Scope

This demonstrates an application workflow that accepts substantial lower-trust raw HTML and server-renders it through `[innerHTML]`. Sites that reject raw HTML, cap attribute counts, or do not SSR submitted content do not have this demonstrated path. The observed consequence is worker starvation and delay to valid requests, not process termination or a proven outage of every deployment. The same-byte and duplicate-name controls distinguish the attribute-name scan from body size, Markdown parsing, and the harness.
