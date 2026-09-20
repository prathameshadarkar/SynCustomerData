import { useEffect } from 'react';
import { X, Check, Sun, Moon } from 'lucide-react';
import { ThemeId } from '../types';
import { THEME_OPTIONS } from '../theme';

interface ThemeSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTheme: ThemeId;
  onSelectTheme: (themeId: ThemeId) => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
}

export function ThemeSelectorModal({
  isOpen,
  onClose,
  currentTheme,
  onSelectTheme,
  isDarkMode,
  onToggleDarkMode,
}: ThemeSelectorModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      id="theme-selector-backdrop"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        id="theme-selector-dialog"
        className="w-full sm:max-w-md bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden animate-in slide-in-from-bottom sm:zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Appearance</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        <div className="p-4 space-y-2">
          {THEME_OPTIONS.map((theme) => {
            const isSelected = currentTheme === theme.id;
            return (
              <button
                key={theme.id}
                id={`theme-option-${theme.id}`}
                onClick={() => onSelectTheme(theme.id)}
                className={`w-full text-left px-3.5 py-3 rounded-xl border transition-colors cursor-pointer flex items-center gap-3 ${
                  isSelected
                    ? 'border-slate-400 dark:border-slate-500 bg-slate-50 dark:bg-slate-800/60'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                }`}
              >
                <span className="flex items-center gap-1 shrink-0">
                  <span className="w-5 h-5 rounded-full shadow-xs" style={{ backgroundColor: theme.primaryColor }} />
                  <span className="w-3 h-5 rounded-sm opacity-70" style={{ backgroundColor: theme.accentColor }} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-slate-900 dark:text-white">{theme.name}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">{theme.tagline}</span>
                </span>
                {isSelected && (
                  <span className="w-5 h-5 rounded-full bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 flex items-center justify-center shrink-0">
                    <Check className="w-3 h-3" />
                  </span>
                )}
              </button>
            );
          })}

          <button
            id="modal-dark-toggle"
            onClick={onToggleDarkMode}
            className="w-full mt-1 px-3.5 py-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors cursor-pointer flex items-center gap-3"
          >
            <span className="w-5 h-5 flex items-center justify-center shrink-0">
              {isDarkMode ? <Sun className="w-4.5 h-4.5 text-amber-400" /> : <Moon className="w-4.5 h-4.5 text-slate-500" />}
            </span>
            <span className="flex-1 text-left text-sm font-semibold text-slate-900 dark:text-white">
              {isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
