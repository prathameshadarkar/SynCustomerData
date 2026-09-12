import { AlertCircle, X, RefreshCw } from 'lucide-react';

interface ErrorAlertProps {
  message: string | null;
  onDismiss: () => void;
  onRetry?: () => void;
  title?: string;
}

export function ErrorAlert({ message, onDismiss, onRetry, title = 'Notice' }: ErrorAlertProps) {
  if (!message) return null;

  return (
    <div
      id="error-alert-banner"
      role="alert"
      className="p-4 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50/90 dark:bg-red-950/40 text-red-800 dark:text-red-200 shadow-sm flex items-start justify-between gap-3 animate-in fade-in slide-in-from-top-1 duration-200"
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
        <div className="text-sm">
          <p className="font-semibold text-red-900 dark:text-red-100">{title}</p>
          <p className="mt-0.5 text-red-700 dark:text-red-300 leading-relaxed break-words">{message}</p>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {onRetry && (
          <button
            onClick={onRetry}
            className="p-1.5 rounded-lg text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/60 transition-colors"
            title="Retry"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={onDismiss}
          className="p-1.5 rounded-lg text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/60 transition-colors"
          title="Dismiss"
          aria-label="Dismiss error"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
