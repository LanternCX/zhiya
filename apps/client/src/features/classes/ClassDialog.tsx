import { Dialog } from "radix-ui";
import { useRef, useState, type ReactNode } from "react";
import Icon from "../../components/Icon";

export function ClassDialog({ title, description, busy, close, children }: {
  title: string; description: string; busy: boolean; close: () => void; children: ReactNode;
}) {
  const previousFocus = useRef(document.activeElement);
  const [open, setOpen] = useState(true);
  return <Dialog.Root open={open} onOpenChange={next => { if (!busy) setOpen(next); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="class-dialog-overlay" />
      <Dialog.Content className="class-dialog" inert={!open} onCloseAutoFocus={event => {
        event.preventDefault();
        // Keep the dialog mounted until Radix finishes its exit animation.
        close();
        const previous = previousFocus.current;
        if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
        else document.querySelector<HTMLElement>('.class-management-tabs [data-state="active"]')?.focus();
      }} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
        <div className="class-dialog-heading"><Dialog.Title>{title}</Dialog.Title><Dialog.Close className="icon-button" aria-label="关闭" disabled={busy}><Icon name="close" /></Dialog.Close></div>
        <Dialog.Description>{description}</Dialog.Description>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : "暂时无法完成操作，请重试";
}
