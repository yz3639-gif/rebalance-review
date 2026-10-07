/** Copy preserved notices into static assets without requiring Python for builds. */
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const target = new URL('public/licenses/', root);
const manifest = JSON.parse(await readFile(new URL('scripts/upstream-licenses.json', root), 'utf8'));
const text = await readFile(new URL('THIRD_PARTY_NOTICES.md', root), 'utf8');
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(new URL('licenses/', root), new URL('licenses/', target), { recursive: true });
await cp(new URL('scripts/upstream-licenses.json', root), new URL('upstream-licenses.json', target));
await cp(new URL('public/fonts/OFL.txt', root), new URL('FONT-OFL.txt', target));
await cp(new URL('LICENSE', root), new URL('PROJECT-LICENSE.txt', target));
await writeFile(new URL('THIRD_PARTY_NOTICES.md', target), text.replaceAll('(scripts/upstream-licenses.json)', '(upstream-licenses.json)').replaceAll('`public/fonts/`', '[font notice](FONT-OFL.txt)'));
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const notice = manifest.unresolved.length ? `<p><strong>${manifest.unresolved.length} upstream attribution limitations remain.</strong> See the exact-source evidence below; this page does not certify legal clearance.</p>` : '';
await writeFile(new URL('index.html', target), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rebalance Review — licenses</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:980px;margin:auto;padding:28px;color:#294333;background:#f6f7f2}a{color:#275d40}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.6 ui-monospace,monospace}a:focus-visible{outline:3px solid #9b5e28;outline-offset:3px}</style><body><main><h1>Licenses and source notices</h1>${notice}<p><a href="/">Back to Rebalance Review</a> · <a href="THIRD_PARTY_NOTICES.md">All preserved notices</a> · <a href="upstream-licenses.json">Exact-source manifest</a> · <a href="/sbom/runtime.cdx.json">Runtime SBOM</a> · <a href="FONT-OFL.txt">Font license</a> · <a href="PROJECT-LICENSE.txt">Project license</a></p><pre>${escape(text)}</pre></main></body></html>`);
console.log('Prepared website license notices.');
