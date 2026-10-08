import { useEffect, useState } from 'react';
import { Download, Monitor, Apple, ArrowUpRight } from 'lucide-react';

type DownloadItem = { id: string; label: string; name: string; url: string; size: number; sha256: string };
type Manifest = { schemaVersion: number; version: string; tag: string; releaseUrl: string; checksumsUrl: string; signing: string; downloads: DownloadItem[] };
const repository = 'https://github.com/LanternCX/zhiya/releases';
const platforms = [
  { id: 'windows-x64', title: 'Windows', detail: 'Windows 10 / 11 · 64 位', suffix: 'windows_x64_setup.exe', icon: Monitor },
  { id: 'macos-arm64', title: 'macOS', detail: 'Apple Silicon · M 系列芯片', suffix: 'macos_arm64.dmg', icon: Apple },
];

function parseManifest(value: unknown): Manifest | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Manifest;
  if (data.schemaVersion !== 1 || typeof data.version !== 'string' ||
      !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:alpha|beta|rc)\.(0|[1-9]\d*))?$/.test(data.version) ||
      data.tag !== `v${data.version}` || data.signing !== 'untrusted' ||
      data.releaseUrl !== `${repository}/tag/${data.tag}` || data.checksumsUrl !== `${repository}/download/${data.tag}/SHA256SUMS.txt` ||
      !Array.isArray(data.downloads) || data.downloads.length !== platforms.length) return null;
  for (const platform of platforms) {
    const item = data.downloads.find(item => item?.id === platform.id);
    const name = `Zhiya_${data.version}_${platform.suffix}`;
    if (!item || item.name !== name || typeof item.label !== 'string' || !Number.isSafeInteger(item.size) || item.size <= 0 ||
        typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256) ||
        item.url !== `${repository}/download/${data.tag}/${name}`) return null;
  }
  return data;
}

export default function Downloads() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}downloads.json`, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('Download information unavailable'); return response.json(); })
      .then(value => { setManifest(parseManifest(value)); setLoading(false); })
      .catch(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  return <section className="content-section download-section" id="download" aria-labelledby="download-title">
    <div className="section-heading"><p className="eyebrow">下载知芽</p><h2 id="download-title">把知芽，带到你的桌面。</h2><p>选择适合你电脑的安装包。</p></div>
    <p className="download-version" role="status">{loading ? '正在读取下载信息…' : manifest ? `版本 ${manifest.version}` : '安装包准备中'}</p>
    <div className="download-grid">
      {platforms.map(({ id, title, detail, icon: Icon }) => {
        const item = manifest?.downloads.find(item => item.id === id);
        return <article className="download-card" key={id}><Icon aria-hidden="true" /><h3>{title}</h3><p>{detail}</p>{item
          ? <><a className="product-link" href={item.url} aria-label={`下载 ${item.label}`}><Download aria-hidden="true" />下载安装包</a><small>{(item.size / 1024 / 1024).toFixed(1)} MB</small></>
          : <span className="download-pending">准备中</span>}</article>;
      })}
    </div>
    <div className="download-metadata"><a href={manifest?.releaseUrl ?? repository} target="_blank" rel="noreferrer">{manifest ? '版本说明' : 'GitHub Releases'}<ArrowUpRight aria-hidden="true" /></a>{manifest && <a href={manifest.checksumsUrl}>SHA-256 校验文件<ArrowUpRight aria-hidden="true" /></a>}</div>
    {!loading && !manifest && <p className="installation-note">安装包尚未发布，可先到 GitHub Releases 查看现有版本。</p>}
    <p className="installation-note">当前安装包未使用受信任的开发者签名，macOS 版本未通过 Apple 公证。首次安装可能出现系统提示。</p>
    <div className="installation-guides">
      <details><summary>Windows 首次安装</summary><p>下载并打开安装程序。如果 Windows 提示“未知发布者”或 SmartScreen 警告，请先确认文件来自本页链接的 GitHub Release，并核对校验值。确认信任后，可在系统允许时选择“更多信息 → 仍要运行”。受管理设备可能禁止继续安装，请联系管理员。</p></details>
      <details><summary>macOS 首次打开</summary><p>打开 DMG，将 Zhiya 拖入“应用程序”。首次打开被拦截时，确认下载来源后，可在“系统设置 → 隐私与安全性”中选择“仍要打开”。</p><p>若隔离属性仍导致无法打开，确认来源与校验值后，在终端执行以下命令，只移除知芽应用的隔离属性：</p><pre><code>xattr -dr com.apple.quarantine "/Applications/Zhiya.app"</code></pre><p>请先确认应用位于上述路径；无需关闭系统安全保护。</p></details>
    </div>
  </section>;
}
