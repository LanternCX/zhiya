/** One page scroll position drives each embedded panel; native page scrolling stays intact. */
export function connectEmbedScroll(stage: HTMLElement, panel: HTMLElement, frame: HTMLIFrameElement): () => void {
  const document = frame.contentDocument;
  if (!document) return () => {};
  let targets: HTMLElement[] = [];
  let distance = 0;
  let scheduled = 0;
  let measureNeeded = true;
  const resize = new ResizeObserver(() => request(true));
  const progressBar = panel.querySelector<HTMLElement>('.product-scroll-progress');
  const status = panel.querySelector<HTMLElement>('.product-scroll-hint');
  const update = () => {
    scheduled = 0;
    if (measureNeeded) {
      measureNeeded = false;
      const nextTargets = Array.from(document.querySelectorAll<HTMLElement>('body *')).filter(element => {
        const style = document.defaultView!.getComputedStyle(element);
        return !element.closest('[role="dialog"], [role="menu"]') && /auto|scroll/.test(style.overflowY) && element.clientHeight > 0 && element.getBoundingClientRect().width > 0;
      });
      targets.filter(element => !nextTargets.includes(element)).forEach(element => resize.unobserve(element));
      nextTargets.filter(element => !targets.includes(element)).forEach(element => resize.observe(element));
      targets = nextTargets;
      const longest = Math.max(0, ...targets.map(element => element.scrollHeight - element.clientHeight));
      distance = Math.max(320, Math.min(3600, longest + window.innerHeight * .55));
      const previous = stage.getBoundingClientRect();
      const scrollPosition = window.scrollY;
      const top = parseFloat(getComputedStyle(panel).top) || 96;
      stage.style.setProperty('--demo-scroll-distance', distance + 'px');
      stage.style.height = panel.offsetHeight + distance + 'px';
      // Loading an earlier demo must not move the chapter the visitor is reading.
      if (previous.bottom <= top) {
        const change = stage.getBoundingClientRect().height - previous.height;
        if (change) window.scrollTo({ top: scrollPosition + change, behavior: 'instant' });
      }
    }
    const top = parseFloat(getComputedStyle(panel).top) || 96;
    const position = Math.max(0, Math.min(distance, top - stage.getBoundingClientRect().top));
    const progress = distance ? position / distance : 0;
    // In parallel panes, all content is reachable within the same scene.
    targets.forEach(element => {
      const maximum = element.scrollHeight - element.clientHeight;
      if (maximum > 1) element.scrollTop = maximum * progress;
    });
    progressBar?.style.setProperty('--demo-progress', String(progress));
    if (status) {
      const text = progress >= .98 ? '这一段看完了，继续向下' : '继续滚动，展开这一段';
      if (status.textContent !== text) status.textContent = text;
    }
    frame.contentWindow?.dispatchEvent(new CustomEvent('zhiya-demo-scroll', { detail: { progress } }));
  };
  function request(measure = false) {
    measureNeeded ||= measure;
    if (!scheduled) scheduled = requestAnimationFrame(update);
  }
  const scroll = () => request();
  const layout = () => request(true);
  const mutations = new MutationObserver(layout);
  mutations.observe(document.body, { childList: true, subtree: true, characterData: true });
  document.addEventListener('load', layout, true);
  window.addEventListener('scroll', scroll, { passive: true });
  window.addEventListener('resize', layout);
  resize.observe(panel);
  update();
  return () => {
    cancelAnimationFrame(scheduled);
    resize.disconnect();
    mutations.disconnect();
    document.removeEventListener('load', layout, true);
    window.removeEventListener('scroll', scroll);
    window.removeEventListener('resize', layout);
  };
}
