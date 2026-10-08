import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repository = 'LanternCX/zhiya';
export const platforms = [
  { id: 'windows-x64', label: 'Windows · 64 位', suffix: 'windows_x64_setup.exe' },
  { id: 'macos-arm64', label: 'macOS · Apple Silicon', suffix: 'macos_arm64.dmg' },
];

export function releaseVersion(tag) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:alpha|beta|rc)\.(0|[1-9]\d*))?$/.test(tag)) {
    throw new Error('Use a version tag such as v1.2.3 or v1.2.3-alpha.1');
  }
  const version = tag.slice(1);
  const [major, minor, patch] = version.split(/[.-]/).map(Number);
  if (major > 255 || minor > 255 || patch > 65535) throw new Error('Version exceeds Windows installer limits');
  return version;
}

export function validateApiOrigin(origin) {
  let url;
  try { url = new URL(origin); } catch { throw new Error('Configure ZHIYA_API_ORIGIN with the production HTTPS API origin'); }
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password ||
      !url.hostname.includes('.') || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local') ||
      isIP(url.hostname.replace(/^\[|\]$/g, ''))) {
    throw new Error('ZHIYA_API_ORIGIN must be a public HTTPS domain without a path or credentials');
  }
}

function assetName(version, platform) {
  return `Zhiya_${version}_${platform.suffix}`;
}

function collect(tag, input, output, platformId) {
  const version = releaseVersion(tag);
  const platform = platforms.find(item => item.id === platformId);
  if (!platform) throw new Error('Unknown installer platform');
  const extension = platform.id.startsWith('windows') ? '.exe' : '.dmg';
  const files = readdirSync(input, { recursive: true }).filter(name => name.endsWith(extension) && statSync(join(input, name)).isFile());
  if (files.length !== 1) throw new Error(`Expected exactly one ${extension} installer, found ${files.length}`);
  mkdirSync(output, { recursive: true });
  copyFileSync(join(input, files[0]), join(output, assetName(version, platform)));
}

function assemble(tag, input, output) {
  const version = releaseVersion(tag);
  const downloads = platforms.map(platform => {
    const name = assetName(version, platform);
    const data = readFileSync(join(input, name));
    if (!data.length) throw new Error(`Empty installer: ${name}`);
    return { id: platform.id, label: platform.label, name, size: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
      url: `https://github.com/${repository}/releases/download/${tag}/${name}` };
  });
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'SHA256SUMS.txt'), downloads.map(item => `${item.sha256}  ${item.name}\n`).join(''));
  writeFileSync(join(output, 'downloads.json'), JSON.stringify({ schemaVersion: 1, version, tag,
    releaseUrl: `https://github.com/${repository}/releases/tag/${tag}`,
    checksumsUrl: `https://github.com/${repository}/releases/download/${tag}/SHA256SUMS.txt`,
    signing: 'untrusted', downloads }, null, 2) + '\n');
}

// A release is eligible for the website only when the final manifest and every named asset agree.
export function validateManifest(manifest, release) {
  const version = releaseVersion(release.tag_name);
  if (release.draft || manifest.schemaVersion !== 1 || manifest.version !== version ||
      manifest.tag !== release.tag_name || manifest.signing !== 'untrusted' || manifest.downloads?.length !== platforms.length) {
    throw new Error('Release manifest does not match the published release');
  }
  const root = `https://github.com/${repository}/releases`;
  if (manifest.releaseUrl !== `${root}/tag/${release.tag_name}` ||
      manifest.checksumsUrl !== `${root}/download/${release.tag_name}/SHA256SUMS.txt`) throw new Error('Invalid release URLs');
  for (const platform of platforms) {
    const download = manifest.downloads.find(item => item.id === platform.id);
    const name = assetName(version, platform);
    const asset = release.assets.find(item => item.name === name);
    if (!download || download.name !== name || download.label !== platform.label ||
        download.url !== `${root}/download/${release.tag_name}/${name}` || !/^[a-f0-9]{64}$/.test(download.sha256) ||
        !asset || asset.state !== 'uploaded' || asset.size !== download.size || asset.size <= 0 ||
        (asset.digest && asset.digest !== `sha256:${download.sha256}`)) throw new Error(`Incomplete or mismatched installer: ${platform.id}`);
  }
  if (!release.assets.some(asset => asset.name === 'SHA256SUMS.txt' && asset.state === 'uploaded' && asset.size > 0)) {
    throw new Error('Missing checksums');
  }
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command, tag, input, output, platform] = process.argv.slice(2);
    if (command === 'validate') {
      console.log(releaseVersion(tag));
      if (input !== undefined) validateApiOrigin(input);
    } else if (command === 'collect') collect(tag, input, output, platform);
    else if (command === 'assemble') assemble(tag, input, output);
    else throw new Error('Unknown release command');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
