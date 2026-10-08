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
      {[["#start", "认识知芽"], ["#classroom", "学生学习"], ["#prepare", "教师教学"], ["#connect", "班级与分享"]].map(([href, label]) =>
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
          <NoteConveyor side="left"><div className="note-card"><BookOpen /><span>有问题，<br />就问知芽。</span><small>也可以带上自己的学习材料</small></div><div className="note-strip">课件 · 练习 · 代码</div><div className="note-card note-code"><Code2 /><code>print("你好，知芽！")</code></div></NoteConveyor>
          <NoteConveyor side="right"><div className="note-strip">教学 · 学习 · 分享</div><div className="note-card"><Compass /><span>换个例子，<br />再试一次。</span><small>按你的进度来</small></div><div className="note-strip">课件和教案，都能带走 ↗</div></NoteConveyor>
          <div className="hero-content"><p className="eyebrow">教与学，都有知芽陪你</p><h1 id="hero-title">知芽</h1><p className="hero-kicker">教学的好帮手<span>学习的好搭子</span></p><p className="hero-copy">老师备课、讲课，学生提问、练习，都可以试试知芽。</p><div className="hero-actions"><ProductLink /><ActionLink variant="neutral" href="#classroom">体验课堂<ArrowDown aria-hidden="true" /></ActionLink></div></div>
        </section>
        <LearningRibbon paused={marqueePaused} onToggle={() => setMarqueePaused(value => !value)} />
        <div className="site-content">
          <p className="demo-introduction">先试试下面的演示。无需登录，回答和课堂内容都是提前准备好的，你输入的内容不会上传。</p>
          <section className="content-section story-section" id="start" aria-labelledby="start-title">
            <span className="story-index">01 / 个人档案</span><SectionHeading id="start-title" title="说说你的需求">你想学什么，哪些地方还不熟悉，喜欢怎样的讲解？如果你是老师，也可以聊聊教什么、教谁、这次要准备什么。知芽会记住这些背景，你可以随时修改或删除。</SectionHeading><ProductEmbed label="建档与学习记忆演示" initialScene="profile" />
            <div className="capability-strip"><span>学生与教师身份</span><span>自然对话建档</span><span>可更新、可删除的学习记忆</span></div>
          </section>
          <section className="content-section story-section" id="classroom" aria-labelledby="classroom-title">
            <span className="story-index">02 / 学生学习</span><SectionHeading id="classroom-title" title="不懂就问，也可以自己试试">直接提问，或者带上自己的学习材料。知芽可以用课件、动画和视频讲解，也会提供练习和编程题。没听懂就继续问，想换个例子也可以说；下次回来，还能接着上次的进度学。</SectionHeading><ProductEmbed label="交互课堂演示" classroom />
            <div className="capability-strip"><span>提问与材料引用</span><span>讲解、练习与编程实践</span><span>学习保存与继续</span><span>随时追问或调整讲解</span></div>
          </section>
          <section className="content-section story-section" id="prepare" aria-labelledby="prepare-title">
            <span className="story-index">03 / 教师教学</span><SectionHeading id="prepare-title" title="准备课件，修改教案，安排课堂活动">告诉知芽授课对象和这节课要讲什么，让它帮你整理教学思路。已有的 PPT 可以导入，内容不合适就通过对话修改。课件和文档可以直接展示，也能导出、打印或分享给学生。</SectionHeading><ProductEmbed label="备课与内容产物演示" teacher />
            <div className="capability-strip"><span>教学思路与备课教案</span><span>课堂内容与材料组织</span><span>对话修改同步更新</span><span>PPTX · Word · 独立 HTML</span></div>
          </section>
          <section className="content-section story-section" id="connect" aria-labelledby="connect-title">
            <span className="story-index">04 / 班级与分享</span><SectionHeading id="connect-title" title="老师分享材料，学生随时查看">老师创建班级，用邀请码邀请学生加入。课件和文档可以分享给一个或多个班级，也可以生成公开链接。分享的是课堂内容，你的个人对话、练习答案和档案不会一起公开。</SectionHeading><ProductEmbed label="班级与内容分享演示" initialScene="classes" teacher />
            <div className="capability-strip"><span>邀请码与成员管理</span><span>班主任转交与退出</span><span>私有、公开、多班级分享</span><span>最新保存内容的只读访问</span></div>
          </section>
          <section className="content-section about-section" id="about" aria-labelledby="about-title"><SectionHeading id="about-title" title="下次打开，接着用">课程、对话和课堂进度会保存。学生可以继续学习，老师也能回来修改课件和教案。</SectionHeading><div className="about-copy"><p>档案里的背景会用于后续讲解。你可以修改记忆、删除不想保留的信息，也可以在账户设置中维护个人资料、邮箱和密码，或删除账户。</p></div></section>
          <Downloads />
          <section className="content-section closing-section" aria-labelledby="closing-title"><div><h2 id="closing-title">想试试？下载知芽</h2><p>支持 Windows 和 Apple 芯片的 Mac。</p></div><ProductLink /></section>
        </div>
      </main>
      <footer className="site-footer"><div className="footer-top"><div><a className="footer-brand" href="#top"><SproutMark /><span>知芽 ZHIYA</span></a><p>教学的好帮手，学习的好搭子。</p></div><nav aria-label="页尾导航"><a href="#classroom">学生学习</a><a href="#prepare">教师教学</a><a href="#download">下载安装</a></nav></div><div className="footer-bottom"><span>知芽 Zhiya</span><div className="footer-links"><a href={repository} target="_blank" rel="noreferrer" aria-label="GitHub 仓库">GitHub</a><a href={repository + "/blob/main/LICENSE"} target="_blank" rel="noreferrer">AGPL-3.0</a></div></div></footer>
    </div>
  </>;
}
