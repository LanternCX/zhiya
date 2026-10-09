/** Embedded demos must not take focus until the visitor interacts with them. */
export function deferEmbedFocus() {
  if (window.parent === window) return;
  const focus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function () {};
  const activate = () => {
    HTMLElement.prototype.focus = focus;
    document.removeEventListener('pointerdown', activate, true);
    document.removeEventListener('keydown', activate, true);
  };
  document.addEventListener('pointerdown', activate, true);
  document.addEventListener('keydown', activate, true);
}
