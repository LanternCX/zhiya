import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowDown, ArrowRight, BookOpen, Contrast, Code2, Compass, MessagesSquare,
  Menu, Moon, Sun, X,
} from "lucide-react";
import ClassroomScene from "./ClassroomScene";
import { ActionLink } from "./components/ui/Action";
import { FeatureCard } from "./components/ui/Card";
import { Tabs } from "./components/ui/Tabs";
import { ProductLink } from "./components/website/ProductLink";
import { TeachingMedia } from "./components/website/TeachingMedia";
import { OpeningScene, useScrollReveal, useScrollParallax } from "./WebsiteMotion";
import { classroomImages, modalityImages, stageImages } from "./website-content";

const repository = "https://github.com/LanternCX/zhiya";
type Theme = "auto" | "light" | "dark";
const nextTheme: Record<Theme, Theme> = { auto: "light", light: "dark", dark: "auto" };
const themeLabels: Record<Theme, string> = {
  auto: "主题：自动；切换至浅色",
  light: "主题：浅色；切换至深色",
  dark: "主题：深色；切换至自动",
};
const experiences = [
  { icon: BookOpen, title: "课程学习", copy: "沿着清晰的知识结构前进，在讲解与互动练习中建立理解。随时提问，也能回到原来的课堂。", detail: "循序渐进" },
  { icon: MessagesSquare, title: "连续对话", copy: "围绕课程随时提问、追问和复习。从最近对话回到上次的内容，让每一次交流都接得上。", detail: "接着上次学" },
  { icon: Code2, title: "课堂实践", copy: "在讲解中穿插练习和编程，动手验证自己的想法，让具体的尝试帮助理解抽象概念。", detail: "边学边试" },
];
const stages = [
  { name: "小学低年级", title: "故事与观察", copy: "用语音、图画和简单选择，让第一次接触 AI 保持具体。", example: "从认识一只小猫开始", detail: "用故事、声音和图片，发现机器也需要学习很多例子。" },
  { name: "小学高年级", title: "分类与规则", copy: "通过分类和可视化实验，理解数据、标签与判断。", example: "先找特征，再做判断", detail: "在分类活动中观察样本，建立特征与标签之间的联系。" },
  { name: "初中", title: "算法与编程", copy: "在图示基础上加入代码练习，理解算法过程和调试方法。", example: "让数据帮助我们做决定", detail: "加入 Python 练习，观察训练数据和测试结果的差异。" },
  { name: "高中", title: "模型与项目", copy: "深入机器学习与项目实践，关注模型评估和责任使用。", example: "训练模型，也学会质疑模型", detail: "讨论模型、误差、偏差和负责任地使用人工智能。" },
];
const lessonSteps = [
  ["提问", "AI 为什么会认错？", "从学生的问题出发，发现已有经验与新知识之间的联系。"],
  ["讲解", "把分类变成看得见的过程", "用图示、语音和动画解释数据、特征与标签。"],
  ["实践", "调整样本，观察模型变化", "动手改变样本与参数，观察结果如何变化。"],
  ["反馈", "下一步学习什么？", "结合回答和操作表现，安排复习、变式或新的挑战。"],
] as const;
const modalities = [
  { title: "对话与语音", copy: "用熟悉的方式提问，在连续的对话中把一个问题想明白。" },
  { title: "动画与绘本", copy: "让抽象过程变得直观，为不同年龄找到合适的理解入口。" },
  { title: "编程与练习", copy: "通过代码、实验与练习验证想法，把知识用到真实任务中。" },
];

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
      {[["#experience", "产品体验"], ["#stages", "学段适配"], ["#multimodal", "多模态教学"], ["#about", "关于知芽"]].map(([href, label]) =>
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
  const [lessonStep, setLessonStep] = useState(0);
  const [selectedStage, setSelectedStage] = useState(2);
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
  const stage = stages[selectedStage];

  return <>
    <a className="skip-link" href="#main">跳到主要内容</a>
    <OpeningScene />
    <div className="page-shell" id="top" data-marquee-paused={marqueePaused}>
      <Header theme={theme} onTheme={() => setTheme(nextTheme[theme])} />
      <main id="main" tabIndex={-1}>
        <section className="hero" aria-labelledby="hero-title">
          <NoteConveyor side="left">
            <div className="note-card"><BookOpen /><span>让好奇心<br />带路。</span><small>从一个好问题开始</small></div>
            <div className="note-strip">数据 → 特征 → 模型</div>
            <div className="note-card note-code"><Code2 /><code>while curious:<br />&nbsp; keep_learning()</code></div>
          </NoteConveyor>
          <NoteConveyor side="right">
            <div className="note-strip">观察 · 提问 · 动手</div>
            <div className="note-card"><Compass /><span>不止知道，<br />更要理解。</span><small>探索人工智能的每一种可能</small></div>
            <div className="note-strip">HELLO, AI WORLD ↗</div>
          </NoteConveyor>
          <div className="hero-content">
            <p className="eyebrow">从好奇，到理解</p>
            <h1 id="hero-title">知芽</h1>
            <p className="hero-kicker">面向 K12 的<span>人工智能学习搭子</span></p>
            <p className="hero-copy">把抽象的知识，变成看得见的理解。</p>
            <div className="hero-actions"><ProductLink /><ActionLink variant="neutral" href="#experience">了解知芽<ArrowDown aria-hidden="true" /></ActionLink></div>
          </div>
        </section>

        <LearningRibbon paused={marqueePaused} onToggle={() => setMarqueePaused(value => !value)} />

        <div className="site-content">
          <section className="content-section" id="experience" aria-labelledby="experience-title">
            <SectionHeading id="experience-title" title="在对话中学习，在课堂里实践">沿着课程前进，随时提问，也随时回来继续。</SectionHeading>
            <div className="feature-grid" id="learning">
              {experiences.map(({ icon: Icon, title, copy, detail }) => <FeatureCard key={title} title={title}
                description={copy} icon={<Icon aria-hidden="true" />} note={detail} />)}
            </div>
            <div className="experiment-layout">
              <div className="experiment-copy"><span className="section-index">TRY IT / 动手看一看</span><h3>一条直线，<br />怎么学会预测？</h3><p>从一组散点出发，观察数据、拟合直线，再试着预测一个新的数值。</p><ActionLink variant="neutral" href="#lesson">走进知芽课堂<ArrowRight aria-hidden="true" /></ActionLink></div>
              <div className="hero-visual"><div className="experiment-title"><span>线性回归 / LINEAR REGRESSION</span><span aria-hidden="true">↗</span></div><ClassroomScene /></div>
            </div>
          </section>

          <section className="content-section" id="lesson" aria-labelledby="lesson-title">
            <SectionHeading id="lesson-title" title="从一个问题，到真正理解">提问、讲解、实践与反馈，让每一步学习都有回应。</SectionHeading>
            <Tabs ariaLabel="课堂步骤" idPrefix="lesson-tab" items={lessonSteps.map(([label]) => label)}
              onSelect={setLessonStep} panelId="lesson-panel" selectedIndex={lessonStep} />
            <div className="lesson-layout" role="tabpanel" id="lesson-panel" aria-labelledby={`lesson-tab-${lessonStep}`}>
              <TeachingMedia key={lessonStep} image={classroomImages[lessonStep]} />
              <div className="lesson-copy" key={`copy-${lessonStep}`}><h3>{lessonSteps[lessonStep][1]}</h3><p>{lessonSteps[lessonStep][2]}</p><ProductLink /></div>
            </div>
          </section>

          <section className="content-section" id="stages" aria-labelledby="stages-title">
            <SectionHeading id="stages-title" title="每个阶段，都有合适的起点">从具体观察到模型实践，知识深度与学习方式一起成长。</SectionHeading>
            <Tabs ariaLabel="学段选择" className="grade-tabs" idPrefix="grade-tab" items={stages.map(({ name }) => name)}
              onSelect={setSelectedStage} panelId="grade-panel" selectedIndex={selectedStage} />
            <div className="stage-detail" role="tabpanel" id="grade-panel" aria-labelledby={`grade-tab-${selectedStage}`}>
              <TeachingMedia key={selectedStage} image={stageImages[selectedStage]} />
              <div className="stage-copy" key={`copy-${selectedStage}`}>
                <h3>{stage.title}</h3><p>{stage.copy}</p>
                <div className="stage-example"><h4>{stage.example}</h4><p>{stage.detail}</p></div>
              </div>
            </div>
          </section>

          <section className="content-section" id="multimodal" aria-labelledby="multimodal-title">
            <SectionHeading id="multimodal-title" title="让每一种知识，都有合适的讲法。">听、看、动手尝试，用适合自己的方式认识人工智能。</SectionHeading>
            <div className="feature-grid modality-grid">
              {modalities.map(({ title, copy }, index) => <FeatureCard key={title} title={title} description={copy}
                media={<TeachingMedia image={modalityImages[index]} />} />)}
            </div>
          </section>

          <section className="content-section about-section" id="about" aria-labelledby="about-title">
            <SectionHeading id="about-title" title="关于知芽" />
            <div className="about-copy"><p className="about-lead">让人工智能，成为每个学生都能理解的知识。</p>
              <p>知芽面向小学至高中学生，在课程对话中组织讲解、练习与编程实践。我们关注学生怎样理解、在哪里遇到困难，以及下一次尝试需要什么支持。</p>
              <p>以教材和知识体系组织内容，以具体的回答与实践表现安排下一步。让技术帮助学习，也让学生学会理解和审慎使用技术。</p>
            </div>
          </section>

          <section className="content-section closing-section" aria-labelledby="closing-title">
            <div><h2 id="closing-title">从好奇开始，向理解生长。</h2><p>和知芽一起，探索人工智能。</p></div><ProductLink />
          </section>
        </div>
      </main>
      <footer className="site-footer">
        <div className="footer-top">
          <div><a className="footer-brand" href="#top"><SproutMark /><span>知芽 ZHIYA</span></a><p>面向小学至高中学生的人工智能通识学习产品。</p></div>
          <nav aria-label="页尾导航"><a href="#experience">产品介绍</a><a href="#about">关于知芽</a></nav>
        </div>
        <div className="footer-bottom"><span>让每一次好奇，都有继续探索的可能。</span><div className="footer-links">
          <a href={repository} target="_blank" rel="noreferrer" aria-label="GitHub 仓库">GitHub</a>
          <a href={`${repository}/blob/main/LICENSE`} target="_blank" rel="noreferrer">AGPL-3.0</a>
        </div></div>
      </footer>
    </div>
  </>;
}
