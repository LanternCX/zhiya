import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateManifest } from './release.mjs';
import { selectDownloadRelease } from './website-downloads.mjs';

const script = new URL('./release.mjs', import.meta.url).pathname;
function run(...args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}

test('release tags must be semantic versions and production builds require a public HTTPS origin', () => {
  assert.equal(run('validate', 'v1.2.3').status, 0);
  assert.equal(run('validate', 'v1.2.3-alpha.2').status, 0);
  assert.notEqual(run('validate', 'v1.2').status, 0);
  assert.notEqual(run('validate', 'v1.2.3\n').status, 0);
  assert.notEqual(run('validate', 'v1.2.3', 'http://localhost:8080').status, 0);
  assert.notEqual(run('validate', 'v1.2.3', 'https://localhost').status, 0);
  assert.notEqual(run('validate', 'v1.2.3', 'https://api.example.com/path').status, 0);
  assert.equal(run('validate', 'v1.2.3', 'https://api.example.com').status, 0);
});

test('only a complete installer set produces a downloadable release with checksums', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zhiya-release-'));
  try {
    const input = join(dir, 'input');
    const output = join(dir, 'output');
    mkdirSync(input);
    writeFileSync(join(input, 'Zhiya_1.2.3_windows_x64_setup.exe'), 'windows');
    assert.notEqual(run('assemble', 'v1.2.3', input, output).status, 0);
    writeFileSync(join(input, 'Zhiya_1.2.3_macos_arm64.dmg'), 'apple');
    const result = run('assemble', 'v1.2.3', input, output);
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(readFileSync(join(output, 'downloads.json'), 'utf8'));
    assert.equal(manifest.version, '1.2.3');
    assert.equal(manifest.downloads.length, 2);
    assert.equal(manifest.downloads[0].sha256, '340d600392818df2413382dc7d8325c360d83ea49a262d31760348484bbc10b5');
    assert.match(manifest.downloads[0].url, /releases\/download\/v1\.2\.3\/Zhiya_1\.2\.3_windows_x64_setup\.exe$/);
    assert.match(readFileSync(join(output, 'SHA256SUMS.txt'), 'utf8'), /macos_arm64\.dmg/);
    const release = { tag_name: 'v1.2.3', draft: false, assets: [
      ...manifest.downloads.map(item => ({ name: item.name, size: item.size, state: 'uploaded', digest: `sha256:${item.sha256}` })),
      { name: 'SHA256SUMS.txt', size: 200, state: 'uploaded' },
    ] };
    assert.equal(validateManifest(manifest, release).version, '1.2.3');
    assert.throws(() => validateManifest(manifest, { ...release, assets: release.assets.slice(1) }), /Incomplete/);
    assert.throws(() => validateManifest(manifest, { ...release, draft: true }), /published/);
    assert.throws(() => validateManifest(manifest, { ...release, assets: release.assets.map(asset => ({ ...asset, digest: `sha256:${'0'.repeat(64)}` })) }), /mismatched/);
    assert.throws(() => validateManifest({ ...manifest, downloads: manifest.downloads.map(item => ({ ...item, url: 'https://example.com/installer' })) }, release), /mismatched/);
    const complete = { ...release, id: 1, prerelease: false, published_at: '2026-01-01T00:00:00Z', assets: [...release.assets, { name: 'downloads.json', state: 'uploaded' }] };
    const incomplete = { ...complete, id: 2, published_at: '2026-02-01T00:00:00Z', assets: complete.assets.slice(1) };
    assert.equal(selectDownloadRelease([incomplete, complete], () => manifest).version, '1.2.3');
    assert.equal(selectDownloadRelease([{ ...complete, draft: true }], () => manifest), null);
    assert.throws(() => selectDownloadRelease([complete], () => { throw new Error('GitHub unavailable'); }), /GitHub unavailable/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('installer collection normalizes names and refuses ambiguous build output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zhiya-collect-'));
  try {
    const input = join(dir, 'bundle');
    const output = join(dir, 'collected');
    mkdirSync(join(input, 'nsis'), { recursive: true });
    writeFileSync(join(input, 'nsis', 'Zhiya_1.2.3_x64-setup.exe'), 'installer');
    const result = run('collect', 'v1.2.3', input, output, 'windows-x64');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(output, 'Zhiya_1.2.3_windows_x64_setup.exe'), 'utf8'), 'installer');
    writeFileSync(join(input, 'nsis', 'another.exe'), 'other');
    assert.notEqual(run('collect', 'v1.2.3', input, output, 'windows-x64').status, 0);
    assert.notEqual(run('collect', 'v1.2.3', input, output, 'unknown').status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
