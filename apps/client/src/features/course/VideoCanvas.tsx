import type { VideoPage } from "../../../../../packages/learning/src/domain/learning";

export default function VideoCanvas({ page }: { page: VideoPage }) {
  if (!/^BV[0-9A-Za-z]{10}$/.test(page.bvid))
    return <p role="alert">视频标识无效，请重新检索。</p>;

  return (
    <article className="video-page" aria-label={page.title}>
      <header>
        <span>B站视频 · {page.author}</span>
        <h2>{page.title}</h2>
        <p>{page.duration || "时长未知"} · {page.playCount < 0 ? "播放量未知" : `约 ${page.playCount.toLocaleString("zh-CN")} 次播放`}</p>
      </header>
      <iframe
        key={page.bvid}
        title={`B站视频：${page.title}`}
        src={`https://player.bilibili.com/player.html?bvid=${page.bvid}&autoplay=0&danmaku=0`}
        allow="fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
      <footer>
        <span>如无法播放，可前往B站观看</span>
        <a href={`https://www.bilibili.com/video/${page.bvid}`} target="_blank" rel="noopener noreferrer">在B站打开</a>
      </footer>
    </article>
  );
}
