import { useEffect, useMemo, useRef } from "react";
import type { Slide } from "../../domain/learning";
import { renderMarpSlide } from "./marp";

export default function SlideCanvas({ slide }: { slide: Slide }) {
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
      const scale = Math.min(
        iframe.clientWidth / 1280,
        iframe.clientHeight / 720,
      );
      root.style.setProperty(
        "--slide-scale",
        String(scale),
      );
    };

    iframe.addEventListener("load", syncFrame);
    const resize = new ResizeObserver(syncFrame);
    resize.observe(iframe);
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
