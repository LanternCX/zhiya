/** Embedded documents yield wheel scrolling to the website, including nested slides. */
export function forwardEmbedWheel(frame: HTMLIFrameElement): () => void {
  const documents = new WeakSet<Document>();
  const cleanup: Array<() => void> = [];
  function attach(target: HTMLIFrameElement) {
    let document: Document | null;
    try { document = target.contentDocument; } catch { return; }
    if (!document || documents.has(document)) return;
    documents.add(document);
    const view = document.defaultView;
    if (!view) return;
    const style = document.createElement('style');
    style.textContent = '* { scrollbar-width: none !important; } *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }';
    document.head.append(style);
    const wheel = (event: WheelEvent) => {
      // Preserve the browser's zoom gesture.
      if (event.ctrlKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? window.innerHeight : 1;
      window.scrollBy({ top: event.deltaY * unit, left: event.deltaX * unit, behavior: 'instant' });
    };
    view.addEventListener('wheel', wheel, { capture: true, passive: false });
    const scan = () => document.querySelectorAll<HTMLIFrameElement>('iframe').forEach(attach);
    const loaded = (event: Event) => {
      const element = event.target;
      if (element instanceof view.HTMLIFrameElement) attach(element);
    };
    document.addEventListener('load', loaded, true);
    const observer = new MutationObserver(scan);
    observer.observe(document, { childList: true, subtree: true });
    scan();
    cleanup.push(() => {
      observer.disconnect();
      style.remove();
      view.removeEventListener('wheel', wheel, true);
      document.removeEventListener('load', loaded, true);
    });
  }
  attach(frame);
  return () => cleanup.forEach(dispose => dispose());
}
