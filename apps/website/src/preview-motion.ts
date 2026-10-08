/** Animate loaded previews without changing the original product components. */
const active = new WeakMap<HTMLElement, Animation>();

export function revealPreview(element: HTMLElement) {
  active.get(element)?.cancel();
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  if (preference.matches) return;
  const animation = element.animate([
    { opacity: 0, transform: 'translateY(8px)' },
    { opacity: 1, transform: 'translateY(0)' },
  ], { duration: 320, easing: 'cubic-bezier(.2,.7,.2,1)' });
  active.set(element, animation);
  const changed = () => { if (preference.matches) animation.cancel(); };
  const complete = () => preference.removeEventListener('change', changed);
  preference.addEventListener('change', changed);
  void animation.finished.then(complete, complete);
}
