import { Sparkles, Moon, Sun, RefreshCw, FileText, Palette } from 'lucide-react';
import { ThemeId } from '../types';
import { THEME_OPTIONS } from '../theme';

interface HeaderProps {
  filesCount: number;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  onResetSession: () => void;
  isResetting?: boolean;
  currentTheme: ThemeId;
  onOpenThemeModal: () => void;
  /** Display name of the model actually serving generations, e.g. "GPT-4o mini". */
  modelLabel?: string;
}

export function Header({
  filesCount,
  isDarkMode,
  onToggleDarkMode,
  onResetSession,
  isResetting,
  currentTheme,
  onOpenThemeModal,
  modelLabel,
}: HeaderProps) {
  const activeTheme = THEME_OPTIONS.find((t) => t.id === currentTheme) || THEME_OPTIONS[0];

  return (
    <header
      id="app-header"
      className="border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm sticky top-0 z-30"
    >
      <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-3">
        {/* Brand */}
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl text-white flex items-center justify-center shadow-sm shrink-0 transition-colors duration-200"
            style={{ backgroundColor: activeTheme.primaryColor }}
          >
            <FileText className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="text-base sm:text-lg lg:text-xl font-bold tracking-tight text-slate-900 dark:text-white truncate">
                <span className="sm:hidden">Transcript Generator</span>
                <span className="hidden sm:inline">Synthetic Discussion-Guide Transcript Generator</span>
              </h1>
              <span className="hidden lg:inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium theme-badge border whitespace-nowrap">
                <Sparkles className="w-3 h-3 mr-1" />
                Local RAG{modelLabel ? ` • ${modelLabel}` : ''}
              </span>
            </div>
            <p className="hidden sm:block text-xs text-slate-500 dark:text-slate-400 truncate">
              Evidence-informed synthetic research participants grounded in your discussion guide and reference research
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            id="reset-session-btn"
            onClick={onResetSession}
            disabled={isResetting || filesCount === 0}
            className="inline-flex items-center gap-1.5 p-2 sm:px-3 sm:py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            title="Clear all uploaded files, the retrieval index and reset the session"
            aria-label="Reset session"
          >
            <RefreshCw className={`w-4 h-4 sm:w-3.5 sm:h-3.5 ${isResetting ? 'animate-spin' : ''}`} />
            <span className="hidden md:inline">Reset Session</span>
          </button>

          <button
            id="theme-options-btn"
            onClick={onOpenThemeModal}
            className="inline-flex items-center gap-1.5 p-2 sm:px-3 sm:py-1.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
            title="Appearance"
            aria-label="Appearance options"
          >
            <Palette className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
            <span
              className="hidden sm:inline-block w-2.5 h-2.5 rounded-full shadow-2xs"
              style={{ backgroundColor: activeTheme.primaryColor }}
            />
            <span className="hidden md:inline font-semibold">{activeTheme.name}</span>
          </button>

          <button
            id="theme-toggle-btn"
            onClick={onToggleDarkMode}
            className="inline-flex items-center gap-1.5 p-2 sm:px-3 sm:py-1.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
            title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Toggle light or dark mode"
          >
            {isDarkMode ? (
              <>
                <Sun className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-amber-500" />
                <span className="hidden md:inline">Light Mode</span>
              </>
            ) : (
              <>
                <Moon className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-slate-500" />
                <span className="hidden md:inline">Dark Mode</span>
              </>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
