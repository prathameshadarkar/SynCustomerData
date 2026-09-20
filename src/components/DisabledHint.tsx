import { ReactNode, useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';

interface DisabledHintProps {
  /** When false the wrapper is inert and children behave normally. */
  disabled: boolean;
  /** What the user has to do before the action becomes available. */
  message: string;
  children: ReactNode;
  className?: string;
}

/**
 * Wraps a disabled control so that clicking it explains why nothing happened.
 *
 * A disabled <button> dispatches no click event and the click does not bubble to ancestors, so the
 * hint can't be hooked to the button itself. The child is given `pointer-events-none` while
 * disabled (see the `disabled:pointer-events-none` class on the button) and this wrapper catches
 * the click instead.
 */
export function DisabledHint({ disabled, message, children, className = '' }: DisabledHintProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-dismiss, and clean up if the component unmounts while the hint is showing.
  useEffect(() => {
    if (!open) return;
    timerRef.current = setTimeout(() => setOpen(false), 4000);
    const onDocDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // If the control becomes usable while the hint is up, take the hint down.
  useEffect(() => {
    if (!disabled) setOpen(false);
  }, [disabled]);

  return (
    <div
      ref={wrapRef}
      className={`relative ${disabled ? 'cursor-not-allowed' : ''} ${className}`}
      onClick={() => {
        if (disabled) setOpen(true);
      }}
    >
      {children}

      {open && (
        <div
          role="status"
          className="absolute bottom-full right-0 mb-2 z-40 w-[min(17rem,calc(100vw-2rem))] animate-in fade-in slide-in-from-bottom-1 duration-150"
        >
          <div className="rounded-xl bg-slate-900 dark:bg-slate-700 text-white shadow-lg px-3.5 py-2.5 flex items-start gap-2">
            <Info className="w-4 h-4 shrink-0 mt-px text-slate-300" />
            <p className="text-xs leading-relaxed">{message}</p>
          </div>
          <div className="absolute right-6 -bottom-1 w-2.5 h-2.5 rotate-45 bg-slate-900 dark:bg-slate-700" />
        </div>
      )}
    </div>
  );
}
