import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowDown, BookOpen, Contrast, Code2, Compass,
  Menu, Moon, Sun, X,
} from "lucide-react";
import ProductEmbed from "./ProductEmbed";
import Downloads from "./Downloads";
import { ActionLink } from "./components/ui/Action";
import { ProductLink } from "./components/website/ProductLink";
import { OpeningScene, useScrollReveal, useScrollParallax } from "./WebsiteMotion";

const repository = "https://github.com/LanternCX/zhiya";
type Theme = "auto" | "light" | "dark";
const nextTheme: Record<Theme, Theme> = { auto: "light", light: "dark", dark: "auto" };
const themeLabels: Record<Theme, string> = {
  auto: "主题：自动；切换至浅色",
  light: "主题：浅色；切换至深色",
  dark: "主题：深色；切换至自动",
};
function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem("zhiya-website-theme");
    if (stored === "light" || stored === "dark") return stored;
  } catch { /* Keep automatic theme when storage is unavailable. */ }
  return "auto";
}

function SproutMark() {
  return <svg viewBox="0 0 42 42" aria-hidden="true" className="sprout-mark"><path d="M21 35V20M21 27C10 27 7 19 9 8c10 0 14 7 12 19ZM21 21C21 12 27 7 35 8c1 9-4 15-14 13Z" /></svg>;
}

function NoteConveyor({ side, children }: { side: "left" | "right"; children: ReactNode }) {
  return <div className={`hero-notes notes-${side}`} aria-hidden="true"><div className="notes-track">
    {[0, 1, 2].map(copy => <div className="notes-group" key={copy}>{children}</div>)}
  </div></div>;
}

function LearningRibbon({ paused, onToggle }: { paused: boolean; onToggle: () => void }) {
  return <div className="topic-ribbon" role="region" aria-label="学习理念">
    <div className="ribbon-window"><div className="ribbon-track">
      {[0, 1, 2].map(copy => <div className="ribbon-group" key={copy} aria-hidden={copy > 0 ? true : undefined}>
        {["保持好奇", "大胆提问", "动手探索", "真正理解"].map((label, index) => <span className="ribbon-item" key={label}>
          {label}<span className={`ribbon-symbol symbol-${index}`} aria-hidden="true">{["✳", "✿", "✦", "✺"][index]}</span>
        </span>)}
      </div>)}
    </div></div>
    <button className="ribbon-toggle" type="button" onClick={onToggle} aria-label={paused ? "继续装饰滚动" : "暂停装饰滚动"} aria-pressed={paused}>{paused ? "播放" : "暂停"}</button>
  </div>;
}

function Header({ theme, onTheme }: { theme: Theme; onTheme: () => void }) {
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); menuButton.current?.focus(); }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open]);
  return <header className="site-header">
    <a className="brand-link" href="#top" aria-label="知芽首页"><SproutMark /><span>知芽 <span className="brand-english">ZHIYA</span></span></a>
    <nav id="site-navigation" className={open ? "site-nav is-open" : "site-nav"} aria-label="主导航">
      {[["#start", "认识知芽"], ["#classroom", "体验课堂"], ["#prepare", "教师备课"], ["#connect", "班级与分享"]].map(([href, label]) =>
        <a key={href} href={href} onClick={() => setOpen(false)}>{label}</a>)}
    </nav>
    <div className="header-actions">
      <button className="icon-button" type="button" aria-label={themeLabels[theme]} title={themeLabels[theme]} onClick={onTheme}>
        {theme === "auto" ? <Contrast /> : theme === "light" ? <Sun /> : <Moon />}
      </button>
      <ProductLink compact />
      <button className="icon-button menu-button" type="button" aria-expanded={open} aria-controls="site-navigation" ref={menuButton}
        aria-label={open ? "关闭导航" : "打开导航"} onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button>
    </div>
  </header>;
}

function SectionHeading({ id, title, children }: { id: string; title: string; children?: ReactNode }) {
  return <div className="section-heading"><h2 id={id}>{title}</h2>{children && <p>{children}</p>}</div>;
}

export default function App() {
  useScrollReveal();
  useScrollParallax();
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [marqueePaused, setMarqueePaused] = useState(false);
  useEffect(() => {
    const system = matchMedia("(prefers-color-scheme: dark)");
    const update = () => { document.documentElement.dataset.theme = theme === "auto" ? system.matches ? "dark" : "light" : theme; };
    update();
    try { localStorage.setItem("zhiya-website-theme", theme); } catch { /* Theme remains usable without persistence. */ }
    if (theme !== "auto") return;
    system.addEventListener("change", update);
    return () => system.removeEventListener("change", update);
  }, [theme]);
  return <>
    <a className="skip-link" href="#main">跳到主要内容</a><OpeningScene />
    <div className="page-shell" id="top" data-marquee-paused={marqueePaused}>
      <Header theme={theme} onTheme={() => setTheme(nextTheme[theme])} />
      <main id="main" tabIndex={-1}>
        <section className="hero" aria-labelledby="hero-title">
          <NoteConveyor side="left"><div className="note-card"><BookOpen /><span>让好奇心<br />带路。</span><small>从一个好问题开始</small></div><div className="note-strip">材料 → 课堂 → 理解</div><div className="note-card note-code"><Code2 /><code>while curious:<br />&nbsp; keep_learning()</code></div></NoteConveyor>
          <NoteConveyor side="right"><div className="note-strip">学习 · 备课 · 分享</div><div className="note-card"><Compass /><span>不止知道，<br />更要理解。</span><small>把一个问题，讲成一堂课</small></div><div className="note-strip">HELLO, AI WORLD ↗</div></NoteConveyor>
          <div className="hero-content"><p className="eyebrow">从好奇，到理解</p><h1 id="hero-title">知芽</h1><p className="hero-kicker">面向 K12 的<span>人工智能学习搭子</span></p><p className="hero-copy">陪学生探索，也陪老师把一堂课准备好。</p><div className="hero-actions"><ProductLink /><ActionLink variant="neutral" href="#classroom">体验课堂<ArrowDown aria-hidden="true" /></ActionLink><a className="hero-learn-link" href="#start">了解知芽 ↗</a></div></div>
        </section>
        <LearningRibbon paused={marqueePaused} onToggle={() => setMarqueePaused(value => !value)} />
        <div className="site-content">
          <p className="demo-introduction">下面的每个窗口都可以点一点。无需登录，使用预设内容演示，不连接 AI，也不上传你的数据。</p>
          <section className="content-section story-section" id="start" aria-labelledby="start-title">
            <span className="story-index">01 / 从你开始</span><SectionHeading id="start-title" title="先认识你，再一起往前走。">学生说说已有经验和偏好，教师聊聊教学背景与目标。通过自然对话认识你，把有用的背景留给以后的学习与备课。</SectionHeading><ProductEmbed label="建档与学习记忆演示" initialScene="profile" />
            <div className="capability-strip"><span>学生与教师身份</span><span>自然对话建档</span><span>可更新、可删除的学习记忆</span></div>
          </section>
          <section className="content-section story-section" id="classroom" aria-labelledby="classroom-title">
            <span className="story-index">02 / 把问题打开</span><SectionHeading id="classroom-title" title="把一节课，讲成看得见的理解。">带着材料创建课程，沿着大纲展开小节，也可以直接开始独立对话。讲解、课堂展示和你的操作，在同一个空间里接上。</SectionHeading><ProductEmbed label="交互课堂演示" classroom />
            <div className="capability-strip"><span>材料读取与知识来源引用</span><span>多小节、多对话</span><span>课堂保存与继续学习</span><span>随时提问、继续或停止生成</span></div>
          </section>
          <section className="content-section story-section" id="prepare" aria-labelledby="prepare-title">
            <span className="story-index">03 / 从课堂到产物</span><SectionHeading id="prepare-title" title="从备课，到一份拿得走的材料。">组织教学思路，导入已有 PPT，再通过对话修改课堂。切换到文档阅读，把内容带走，继续展示、打印或分享。</SectionHeading><ProductEmbed label="备课与内容产物演示" teacher />
            <div className="capability-strip"><span>教师备课与教案</span><span>PPT 文字、图片导入</span><span>对话修改同步更新</span><span>PPTX · Word · 独立 HTML</span></div>
          </section>
          <section className="content-section story-section" id="connect" aria-labelledby="connect-title">
            <span className="story-index">04 / 一起探索</span><SectionHeading id="connect-title" title="让好内容，在班级里流动。">创建班级、邀请成员，把课堂分享到一个或多个班级。也可以生成无需登录的公开链接；教师材料有自己的班级卡片页。</SectionHeading><ProductEmbed label="班级与内容分享演示" initialScene="classes" teacher />
            <div className="capability-strip"><span>邀请码与成员管理</span><span>班主任转交与退出</span><span>私有、公开、多班级分享</span><span>最新保存内容的只读访问</span></div>
          </section>
          <section className="content-section about-section" id="about" aria-labelledby="about-title"><SectionHeading id="about-title" title="一份好奇，可以走得很远。">知芽面向小学至高中学生与教师，把人工智能通识学习、课堂实践、备课与内容分享连在一起。</SectionHeading><div className="about-copy"><p>课程、对话与课堂状态保存后，可以回来继续。学习背景帮助后续讲解找到合适的起点；分享课堂时，个人对话、练习答案和学习记忆仍留在自己的账户里。</p><p>账户里可以维护个人资料与邮箱、修改密码、验证邮箱或删除账户。</p></div></section>
          <Downloads />
          <section className="content-section closing-section" aria-labelledby="closing-title"><div><h2 id="closing-title">从好奇开始，向理解生长。</h2><p>在自己的桌面上，开始下一次探索。</p></div><ProductLink /></section>
        </div>
      </main>
      <footer className="site-footer"><div className="footer-top"><div><a className="footer-brand" href="#top"><SproutMark /><span>知芽 ZHIYA</span></a><p>学生的学习搭子，教师的备课伙伴。</p></div><nav aria-label="页尾导航"><a href="#classroom">体验课堂</a><a href="#prepare">教师备课</a><a href="#download">下载安装</a></nav></div><div className="footer-bottom"><span>让每一次好奇，都有继续探索的可能。</span><div className="footer-links"><a href={repository} target="_blank" rel="noreferrer" aria-label="GitHub 仓库">GitHub</a><a href={repository + "/blob/main/LICENSE"} target="_blank" rel="noreferrer">AGPL-3.0</a></div></div></footer>
    </div>
  </>;
}
