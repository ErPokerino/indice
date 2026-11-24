import type { ButtonHTMLAttributes, ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Select from "@radix-ui/react-select";
import { AlertTriangle, Check, ChevronDown, X } from "lucide-react";

export function IconButton({
  label,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={"icon-btn " + className}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}

export function Picker({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: Record<string, string>;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select.Root value={value} onValueChange={onChange} disabled={disabled}>
      <Select.Trigger className="picker" aria-label={label} title={label}>
        <Select.Value />
        <Select.Icon>
          <ChevronDown size={13} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="choices" position="popper" sideOffset={6}>
          <Select.Viewport>
            {Object.entries(options).map(([v, l]) => (
              <Select.Item key={v} value={v} className="choice">
                <Select.ItemText>{l}</Select.ItemText>
                <Select.ItemIndicator>
                  <Check size={14} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="shade" />
        <Dialog.Content
          className={"modal " + (wide ? "wide" : "")}
          aria-describedby={undefined}
        >
          <header>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <button className="icon-btn" aria-label="Chiudi">
                <X size={19} />
              </button>
            </Dialog.Close>
          </header>
          <div className="modal-body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = "Elimina",
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={() => { if (!busy) onCancel(); }}>
      <div className="confirm-box">
        <span className="confirm-icon">
          <AlertTriangle size={20} />
        </span>
        <p>{message}</p>
      </div>
      <footer className="actions">
        <button type="button" className="outline" disabled={busy} onClick={onCancel}>
          Annulla
        </button>
        <button type="button" className="danger-btn" disabled={busy} onClick={onConfirm}>
          {busy ? "Eliminazione…" : confirmLabel}
        </button>
      </footer>
    </Modal>
  );
}

export function Brand() {
  return (
    <span className="brand">
      <img src="/indice.svg" alt="" />
      <span>indice</span>
    </span>
  );
}
