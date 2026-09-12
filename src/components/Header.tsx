import { Database, Sparkles, Moon, Sun, RefreshCw, FileText, Palette } from 'lucide-react';
import { ThemeId } from '../types';
import { THEME_OPTIONS } from '../theme';

interface HeaderProps {
  storeName?: string;
  filesCount: number;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  onResetSession: () => void;
  isResetting?: boolean;
  currentTheme: ThemeId;
  onOpenThemeModal: () => void;
}

export function Header({
  storeName,
  filesCount,
  isDarkMode,
  onToggleDarkMode,
  onResetSession,
  isResetting,
  currentTheme,
  onOpenThemeModal,
}: HeaderProps) {
  const activeTheme = THEME_OPTIONS.find((t) => t.id === currentTheme) || THEME_OPTIONS[0];

  return (
    <header id="app-header" className="border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4">
        {/* Brand & Logo */}
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl text-white flex items-center justify-center shadow-sm transition-colors duration-200"
            style={{ backgroundColor: activeTheme.primaryColor }}
          >
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                Synthetic Discussion-Guide Transcript Generator
              </h1>
              <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium theme-badge border">
                <Sparkles className="w-3 h-3 mr-1" />
                Local RAG • Open-weight LLM
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Evidence-informed synthetic research participants grounded in your discussion guide and reference research
            </p>
          </div>
        </div>

        {/* Actions & Status */}
        <div className="flex items-center gap-2.5">
          {storeName ? (
            <div
              id="file-search-store-status"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/50"
              title={`Session store: ${storeName}`}
            >
              <Database className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 animate-pulse" />
              <span>
                Store Active: <strong className="font-semibold">{filesCount} {filesCount === 1 ? 'source' : 'sources'} indexed</strong>
              </span>
            </div>
          ) : (
            <div
              id="file-search-store-idle"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700"
            >
              <Database className="w-3.5 h-3.5" />
              <span>No Store Initialized</span>
            </div>
          )}

          {/* Reset Session */}
          <button
            id="reset-session-btn"
            onClick={onResetSession}
            disabled={isResetting || filesCount === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            title="Clear all uploaded files, the retrieval index and reset the session"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isResetting ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Reset Session</span>
          </button>

          {/* Theme Palette Options Button */}
          <button
            id="theme-options-btn"
            onClick={onOpenThemeModal}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
            title="Browse and select visual themes"
            aria-label="Theme options"
          >
            <Palette className="w-3.5 h-3.5" />
            <span
              className="w-2.5 h-2.5 rounded-full shadow-2xs"
              style={{ backgroundColor: activeTheme.primaryColor }}
            />
            <span className="hidden sm:inline font-semibold">{activeTheme.name}</span>
          </button>

          {/* Light / Dark Mode Toggle */}
          <button
            id="theme-toggle-btn"
            onClick={onToggleDarkMode}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
            title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            aria-label="Toggle theme mode"
          >
            {isDarkMode ? (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-500" />
                <span className="hidden sm:inline">Light Mode</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-slate-500" />
                <span className="hidden sm:inline">Dark Mode</span>
              </>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
