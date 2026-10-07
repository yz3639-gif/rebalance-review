/** npm supplies the CycloneDX generator; no additional package or credentials. */
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const packageInfo = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
for (const [name, extra, destination] of [['runtime', ['--omit=dev'], 'public/sbom'], ['development', [], 'licenses/sbom']]) {
  const result = spawnSync(npm, ['sbom', '--sbom-format=cyclonedx', '--package-lock-only', '--sbom-type=application', ...extra], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr);
  const document = JSON.parse(result.stdout);
  // Remove timestamps/UUIDs so unchanged locked graphs have reproducible bytes.
  delete document.serialNumber;
  document.metadata.component.name = packageInfo.name;
  if (document.metadata) delete document.metadata.timestamp;
  await mkdir(new URL(`../${destination}/`, import.meta.url), { recursive: true });
  await writeFile(new URL(`../${destination}/${name}.cdx.json`, import.meta.url), JSON.stringify(document, null, 2) + '\n');
  console.log(`${name}: ${document.components.length} locked components`);
}
