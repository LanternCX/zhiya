import { useEffect, useState } from "react";

/** Decoration never locks scrolling or keyboard access to the actual page. */
export function OpeningScene() {
  const [visible, setVisible] = useState(() => !matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    if (!visible) return;
    const close = () => setVisible(false);
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Tab") close();
    };
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => { if (preference.matches) close(); };
    const timer = window.setTimeout(close, 3400);
    document.addEventListener("keydown", keyboard);
    preference.addEventListener("change", changed);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", keyboard);
      preference.removeEventListener("change", changed);
    };
  }, [visible]);
  if (!visible) return null;
  return <div className="opening-scene">
    <div className="opening-brand" aria-hidden="true">
      <svg className="growing-tree" viewBox="0 0 320 280">
        <path className="tree-ground" d="M65 253H255" />
        <g className="tree-sprout">
          <path d="M160 251V224" />
          <path className="sprout-leaf" d="M160 236C139 237 132 225 135 210c17 0 27 9 25 26Z" />
          <path className="sprout-leaf" d="M160 230c0-17 12-27 29-26 1 17-10 29-29 26Z" />
        </g>
        <g className="tree-crown">
          <path className="tree-leaves leaves-left" d="M155 176C124 201 78 185 80 157c-30-15-21-54 7-62-8-30 24-52 48-39 20-21 47-8 49 17Z" />
          <path className="tree-leaves leaves-right" d="M161 177c31 24 77 9 78-22 31-16 23-53-7-63 8-29-24-50-48-36-20-17-44-2-44 24Z" />
          <path className="tree-leaves leaves-top" d="M125 112c-27-17-25-49 0-61 0-34 50-45 67-17 34-3 50 38 26 58 0 32-40 40-60 21-12 8-24 7-33-1Z" />
        </g>
        <path className="tree-trunk" pathLength="1" d="M160 251V97M160 180l-38-39-15-5M160 155l34-29 17-5M160 124l-15-17" />
        <path className="tree-veins" d="m102 105 12 9m85-36 10-10M132 76l-8-11m71 89 10 7" />
      </svg>
      <span>知芽</span><small>让好奇，生长。</small>
    </div>
    <button type="button" className="opening-skip" onClick={() => setVisible(false)}>跳过开屏</button>
  </div>;
}

export function useScrollReveal() {
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const targets = document.querySelectorAll<HTMLElement>(".section-heading, #learning .feature-item, .experiment-layout, .modality-grid .feature-item, .about-copy, .closing-section > div");
    let observer: IntersectionObserver | undefined;
    const showAll = () => targets.forEach(element => element.classList.remove("reveal-waiting"));
    const setup = () => {
      observer?.disconnect();
      showAll();
      if (preference.matches || !("IntersectionObserver" in window)) return;
      observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          entry.target.classList.remove("reveal-waiting");
          entry.target.classList.add("reveal-arrived");
          observer?.unobserve(entry.target);
        });
      }, { threshold: 0.08 });
      targets.forEach(element => {
        if (element.getBoundingClientRect().top < window.innerHeight) return;
        element.classList.add("reveal-waiting");
        observer?.observe(element);
      });
    };
    setup();
    preference.addEventListener("change", setup);
    return () => { observer?.disconnect(); showAll(); preference.removeEventListener("change", setup); };
  }, []);
}

export function useScrollParallax() {
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const hero = document.querySelector<HTMLElement>(".hero");
    const chapters = document.querySelectorAll<HTMLElement>(".story-section");
    let frame = 0;
    const update = () => {
      frame = 0;
      if (!hero) return;
      if (preference.matches) {
        hero.style.setProperty("--parallax", "0px");
        chapters.forEach(chapter => chapter.style.setProperty("--parallax", "0px"));
        return;
      }
      const mobile = window.innerWidth <= 800 ? .4 : 1;
      const rect = hero.getBoundingClientRect();
      const progress = Math.max(0, Math.min(-rect.top, rect.height));
      hero.style.setProperty("--parallax", `${progress * .15 * mobile}px`);
      chapters.forEach(chapter => {
        const panel = chapter.getBoundingClientRect();
        const offset = (window.innerHeight / 2 - panel.top) * .055 * mobile;
        chapter.style.setProperty("--parallax", `${Math.max(-20, Math.min(20, offset))}px`);
      });
    };
    const request = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", request, { passive: true });
    window.addEventListener("resize", request);
    preference.addEventListener("change", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", request);
      window.removeEventListener("resize", request);
      preference.removeEventListener("change", update);
      hero?.style.removeProperty("--parallax");
      chapters.forEach(chapter => chapter.style.removeProperty("--parallax"));
    };
  }, []);
}
