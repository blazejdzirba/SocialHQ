import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/utils/cn";
import { Icon, type IconName } from "./icons";

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type ButtonSize = "xs" | "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
}

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-[#0b0f0e] hover:bg-accent-bright shadow-[0_6px_24px_-10px_rgba(191,239,0,0.65)] font-semibold",
  secondary:
    "bg-white/[0.04] text-fg hover:bg-white/[0.08] border border-white/10 hover:border-white/20",
  ghost: "text-muted hover:text-fg hover:bg-white/[0.06]",
  danger: "bg-danger/15 text-danger hover:bg-danger/25 border border-danger/25",
  outline: "border border-accent/45 text-accent hover:bg-accent/10",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  xs: "h-7 px-2.5 text-[11px] gap-1.5 rounded-lg",
  sm: "h-9 px-3.5 text-[13px] gap-2 rounded-xl",
  md: "h-11 px-5 text-sm gap-2 rounded-xl",
};

export function Button({
  variant = "secondary",
  size = "sm",
  icon,
  iconRight,
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap transition-all duration-150",
        "disabled:opacity-45 disabled:pointer-events-none active:scale-[0.98]",
        BUTTON_SIZES[size],
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : icon ? (
        <Icon name={icon} size={size === "xs" ? 13 : 15} />
      ) : null}
      {children}
      {iconRight && !loading ? <Icon name={iconRight} size={size === "xs" ? 13 : 15} /> : null}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function IconButton({
  icon,
  label,
  variant = "ghost",
  size = "sm",
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex items-center justify-center transition-all duration-150",
        "disabled:opacity-40 disabled:pointer-events-none active:scale-95",
        size === "xs" ? "h-7 w-7 rounded-lg" : "h-9 w-9 rounded-xl",
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={size === "xs" ? 14 : 16} />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Form fields                                                         */
/* ------------------------------------------------------------------ */

interface FieldProps {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
  counter?: ReactNode;
}

export function Field({ label, hint, required, children, className, counter }: FieldProps) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 flex items-center justify-between gap-3">
        <span className="caps text-faint">
          {label}
          {required ? <span className="ml-1 text-accent">*</span> : null}
        </span>
        {counter}
      </span>
      {children}
      {hint ? <span className="mt-1.5 block text-[11.5px] leading-relaxed text-faint">{hint}</span> : null}
    </label>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("field", className)} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("field resize-y leading-relaxed", className)} {...rest} />;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[];
}

export function Select({ options, className, ...rest }: SelectProps) {
  return (
    <div className="relative">
      <select
        className={cn("field appearance-none pr-9 capitalize", className)}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} className="bg-elevated text-fg">
            {option.label}
          </option>
        ))}
      </select>
      <Icon
        name="chevronDown"
        size={15}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-faint"
      />
    </div>
  );
}

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
}

export function TagInput({ value, onChange, placeholder, suggestions = [] }: TagInputProps) {
  const [draft, setDraft] = useState("");
  const inputId = useId();

  const add = (raw: string) => {
    const tag = raw.trim();
    if (!tag) return;
    if (!value.some((item) => item.toLowerCase() === tag.toLowerCase())) {
      onChange([...value, tag]);
    }
    setDraft("");
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-2">
      {value.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.07] px-2 py-1 text-[11.5px] text-fg"
        >
          #{tag}
          <button
            type="button"
            onClick={() => onChange(value.filter((item) => item !== tag))}
            className="text-faint transition-colors hover:text-danger"
            aria-label={`Usuń tag ${tag}`}
          >
            <Icon name="close" size={12} />
          </button>
        </span>
      ))}
      <input
        id={inputId}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            add(draft);
          }
          if (event.key === "Backspace" && !draft && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => add(draft)}
        placeholder={value.length === 0 ? placeholder : "Dodaj tag…"}
        className="min-w-[120px] flex-1 bg-transparent px-1.5 py-1 text-[13px] outline-none placeholder:text-faint"
      />
      {suggestions.length > 0 && draft.length > 0 ? (
        <div className="flex w-full flex-wrap gap-1.5 pt-1">
          {suggestions
            .filter((item) => item.toLowerCase().includes(draft.toLowerCase()))
            .slice(0, 6)
            .map((item) => (
              <button
                key={item}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => add(item)}
                className="rounded-md bg-white/[0.06] px-2 py-0.5 text-[11px] text-muted hover:text-fg"
              >
                #{item}
              </button>
            ))}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

export function Card({
  className,
  children,
  ...rest
}: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("card p-5", className)} {...rest}>
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "warn" | "danger" | "info";
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-white/[0.06] text-muted border-white/10",
    accent: "bg-accent/15 text-accent border-accent/25",
    warn: "bg-warn/15 text-warn border-warn/25",
    danger: "bg-danger/15 text-danger border-danger/25",
    info: "bg-info/15 text-info border-info/25",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("caps text-faint", className)}>{children}</div>;
}

export function EmptyState({
  icon = "brand",
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-14 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent">
        <Icon name={icon} size={22} />
      </div>
      <h3 className="text-[15px] font-medium text-fg">{title}</h3>
      <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg" | "xl";
}

const MODAL_WIDTHS: Record<string, string> = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-3xl",
  xl: "max-w-5xl",
};

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "md",
}: ModalProps) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-[3px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative my-auto w-full animate-scale-in overflow-hidden rounded-[18px] border border-white/10 bg-[#0d1211] shadow-2xl shadow-black/60",
          MODAL_WIDTHS[width],
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-fg">{title}</h2>
            {description ? (
              <p className="mt-1 max-w-lg text-[12.5px] leading-relaxed text-muted">{description}</p>
            ) : null}
          </div>
          <IconButton icon="close" label="Zamknij" onClick={onClose} />
        </header>
        <div className="scroll-thin max-h-[68vh] overflow-y-auto px-5 py-5">{children}</div>
        {footer ? (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-white/[0.07] bg-black/20 px-5 py-3.5">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export function StepHeader({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      {steps.map((step, index) => (
        <div key={step} className="flex items-center gap-2">
          <span
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold transition-colors",
              index < current
                ? "bg-accent text-[#0b0f0e]"
                : index === current
                  ? "border border-accent bg-accent/15 text-accent"
                  : "border border-white/15 text-faint",
            )}
          >
            {index + 1}
          </span>
          <span
            className={cn(
              "text-[11.5px]",
              index === current ? "text-fg" : "text-faint",
            )}
          >
            {step}
          </span>
          {index < steps.length - 1 ? (
            <span className="mx-1 h-px w-6 bg-white/10" aria-hidden="true" />
          ) : null}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Confirm dialog                                                      */
/* ------------------------------------------------------------------ */

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Usuń",
  onConfirm,
  onCancel,
  danger = true,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      width="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Anuluj
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-[13px] leading-relaxed text-muted">{message}</p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
      aria-label="Ładowanie"
    />
  );
}

export function KeyboardHint({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((key) => (
        <kbd
          key={key}
          className="rounded-md border border-white/12 bg-white/[0.05] px-1.5 py-0.5 font-sans text-[10.5px] font-medium text-muted"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

export function useAutoFocus<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (active) ref.current?.focus();
  }, [active]);
  return ref;
}
