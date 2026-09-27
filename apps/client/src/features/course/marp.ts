import { Marp } from "@marp-team/marp-core";
import shikiPlugin from "@marp-team/marp-core/plugins/shiki";
import katexPlugin from "@marp-team/marp-core/plugins/katex";

const theme = `
/* @theme zhiya */

section {
  background: var(--slide-paper);
  color: var(--slide-ink);
  font-family: "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 30px;
  line-height: 1.4;
  padding: 58px 76px 62px;
}

section h1 {
  border-bottom: 2px solid var(--slide-rule);
  color: var(--slide-ink);
  font-size: 58px;
  font-weight: 750;
  letter-spacing: -0.035em;
  line-height: 1.15;
  margin: 0 0 28px;
  padding-bottom: 20px;
}

section h2 { color: var(--slide-ink); font-size: 38px; margin: 20px 0 12px; }
section p { margin: 0 0 22px; }
section strong { color: var(--slide-ink); font-weight: 800; }
section ul, section ol { margin: 10px 0 0; padding-left: 1.35em; }
section li { margin: 9px 0; padding-left: 0.15em; }
section li::marker { color: var(--slide-accent); font-weight: 700; }
section blockquote {
  border-left: 4px solid var(--slide-rule);
  color: var(--slide-muted);
  margin: 20px 0;
  padding: 10px 0 10px 24px;
}
section table { border-collapse: collapse; font-size: 25px; margin-top: 16px; width: 100%; }
section th, section td { border-bottom: 2px solid var(--slide-rule); padding: 13px 18px; text-align: left; }
section th { background: var(--slide-tint); color: var(--slide-ink); font-weight: 700; }
section pre {
  background: var(--slide-code);
  border: 1px solid var(--slide-rule);
  border-radius: 10px;
  color: var(--slide-ink);
  font-size: 24px;
  line-height: 1.35;
  margin: 18px 0 20px;
  overflow: hidden;
  padding: 24px 28px;
}
section code { font-family: "JetBrains Mono", "SFMono-Regular", Consolas, monospace; }
section :not(pre) > code { background: var(--slide-tint); border-radius: 6px; padding: 0.08em 0.3em; }
`;

const marp = new Marp({
  anchor: false,
  emoji: { shortcode: false, unicode: false },
  html: false,
  inlineSVG: false,
  math: "katex",
  script: false,
  slug: false,
}).use(shikiPlugin()).use(katexPlugin());
marp.themeSet.default = marp.themeSet.add(theme);

export function renderMarpSlide(markdown: string) {
  const rendered = marp.render(markdown, { htmlAsArray: true });
  if (!Array.isArray(rendered.html) || rendered.html.length !== 1) {
    throw new Error("课件内容必须恰好生成一页");
  }

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data: https://cdn.jsdelivr.net"><style>
${rendered.css}
html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: var(--slide-paper); }
html {
  --slide-paper: #fff;
  --slide-ink: #242424;
  --slide-muted: #6f716d;
  --slide-accent: #286443;
  --slide-rule: #d8dad5;
  --slide-tint: #f7f7f5;
  --slide-code: #f7f7f5;
  --slide-keyword: #854b98;
  --slide-string: #a34724;
  --slide-number: #215e9a;
  --marp-shiki-background: var(--slide-code);
  --marp-shiki-foreground: var(--slide-ink);
  --marp-shiki-token-keyword: var(--slide-keyword);
  --marp-shiki-token-function: var(--slide-accent);
  --marp-shiki-token-constant: var(--slide-number);
  --marp-shiki-token-string: var(--slide-string);
  --marp-shiki-token-comment: var(--slide-muted);
}
html[data-theme="dark"] {
  --slide-paper: #262626;
  --slide-ink: #e7e7e3;
  --slide-muted: #aaada7;
  --slide-accent: #9bd3a9;
  --slide-rule: #393a38;
  --slide-tint: #2c2c2c;
  --slide-code: #2c2c2c;
  --slide-keyword: #d9afe4;
  --slide-string: #f1b08d;
  --slide-number: #a9c8f4;
  --marp-shiki-background: var(--slide-code);
  --marp-shiki-foreground: var(--slide-ink);
  --marp-shiki-token-keyword: var(--slide-keyword);
  --marp-shiki-token-function: var(--slide-accent);
  --marp-shiki-token-constant: var(--slide-number);
  --marp-shiki-token-string: var(--slide-string);
  --marp-shiki-token-comment: var(--slide-muted);
}
.marpit { position: absolute; width: 1280px; height: 720px; left: 50%; top: 50%; transform: translate(-50%, -50%) scale(var(--slide-scale, 1)); transform-origin: center; }
</style></head><body><div class="marpit">${rendered.html[0]}</div></body></html>`;
}
