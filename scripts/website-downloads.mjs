import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateManifest } from './release.mjs';

export function selectDownloadRelease(releases, readManifest) {
  // Prefer stable versions; alpha/beta/rc are available when no complete stable release exists.
  const candidates = releases.filter(release => !release.draft)
    .sort((a, b) => Number(a.prerelease) - Number(b.prerelease) || new Date(b.published_at) - new Date(a.published_at));
  for (const release of candidates) {
    const asset = release.assets.find(asset => asset.name === 'downloads.json' && asset.state === 'uploaded');
    if (!asset) continue;
    // Transport failures must fail the build, rather than replacing valid downloads with an empty page.
    const content = readManifest(asset);
    try {
      const manifest = typeof content === 'string' ? JSON.parse(content) : content;
      return validateManifest(manifest, release);
    } catch (error) { console.warn(`Skipping incomplete release ${release.tag_name}: ${error.message}`); }
  }
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const repository = 'LanternCX/zhiya';
    const api = args => execFileSync('gh', ['api', ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const releases = JSON.parse(api(['--paginate', '--slurp', `repos/${repository}/releases?per_page=100`])).flat();
    const manifest = selectDownloadRelease(releases, asset => api(['-H', 'Accept: application/octet-stream', `repos/${repository}/releases/assets/${asset.id}`]));
    const destination = process.argv[2] || 'apps/website/public/downloads.json';
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, JSON.stringify(manifest ?? { schemaVersion: 1, version: null, downloads: [] }, null, 2) + '\n');
    console.log(manifest ? `Website downloads: ${manifest.tag}` : 'No complete release; website shows preparing');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
