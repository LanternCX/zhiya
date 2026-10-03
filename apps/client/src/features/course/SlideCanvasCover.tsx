import { useEffect, useMemo, useRef } from "react";
import type { Slide } from "../../../../../packages/learning/src/domain/learning";
import { renderMarpSlide } from "./marp";

/**
 * 课件渲染组件（铺满模式）
 *
 * 与原 SlideCanvas 的唯一区别：缩放使用 Math.max（cover）而非 Math.min（contain）。
 * 这样课件会等比放大至铺满整个课件栏，超出部分裁切掉，避免左右出现大量留白。
 *
 * 原文件 SlideCanvas.tsx 保持不变。
 */
export default function SlideCanvasCover({ slide }: { slide: Slide }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const srcDoc = useMemo(() => {
    try {
      return renderMarpSlide(slide.markdown);
    } catch {
      return null;
    }
  }, [slide.markdown]);

  useEffect(() => {
    const iframe = frame.current;
    if (!iframe || !srcDoc) return;

    const syncFrame = () => {
      const document = iframe.contentDocument;
      const root = document?.documentElement;
      if (!root) return;
      root.dataset.theme =
        window.document.documentElement.dataset.theme === "dark"
          ? "dark"
          : "light";
      const appColors = window.getComputedStyle(window.document.documentElement);
      for (const [slideColor, appColor] of [
        ["paper", "surface"],
        ["ink", "text"],
        ["muted", "muted"],
        ["accent", "accent"],
        ["rule", "line"],
        ["tint", "subtle"],
        ["code", "subtle"],
      ]) {
        root.style.setProperty(
          `--slide-${slideColor}`,
          appColors.getPropertyValue(`--${appColor}`).trim(),
        );
      }
      // 宽度优先：课件宽度始终撑满课件栏，高度按 16:9 等比缩放，上下留白
      const scale = iframe.clientWidth / 1280;
      root.style.setProperty("--slide-scale", String(scale));
    };

    iframe.addEventListener("load", syncFrame);
    const resize = new ResizeObserver(syncFrame);
    resize.observe(iframe);
    if (iframe.parentElement) resize.observe(iframe.parentElement);
    const theme = new MutationObserver(syncFrame);
    theme.observe(window.document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    syncFrame();
    return () => {
      iframe.removeEventListener("load", syncFrame);
      resize.disconnect();
      theme.disconnect();
    };
  }, [srcDoc]);

  if (!srcDoc) {
    return (
      <div className="lesson-slide" role="alert">
        课件页面暂时无法展示：{slide.title}
      </div>
    );
  }

  return (
    <iframe
      ref={frame}
      className="lesson-slide"
      title={`课件页面：${slide.title}`}
      role="img"
      sandbox="allow-same-origin"
      srcDoc={srcDoc}
    />
  );
}
