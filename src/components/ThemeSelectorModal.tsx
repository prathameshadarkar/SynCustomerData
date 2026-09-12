import { useEffect } from 'react';
import { X, Check, Sun, Moon, Palette } from 'lucide-react';
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
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      id="theme-selector-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        id="theme-selector-dialog"
        className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-4.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/40">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Palette className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span>Theme & Appearance Options</span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Choose a visual theme designed for your research discipline
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Quick Dark Mode Switch */}
            <button
              id="modal-dark-toggle"
              onClick={onToggleDarkMode}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer border border-slate-200 dark:border-slate-700"
              title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {isDarkMode ? (
                <>
                  <Sun className="w-3.5 h-3.5 text-amber-400" />
                  <span>Light Mode</span>
                </>
              ) : (
                <>
                  <Moon className="w-3.5 h-3.5 text-slate-600" />
                  <span>Dark Mode</span>
                </>
              )}
            </button>

            {/* Close Button */}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Theme Options Grid */}
        <div className="p-6 max-h-[70vh] overflow-y-auto space-y-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {THEME_OPTIONS.map((theme) => {
              const isSelected = currentTheme === theme.id;
              return (
                <button
                  key={theme.id}
                  id={`theme-option-${theme.id}`}
                  onClick={() => onSelectTheme(theme.id)}
                  className={`relative text-left p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                    isSelected
                      ? 'border-indigo-600 dark:border-indigo-500 bg-indigo-50/20 dark:bg-indigo-950/20 ring-2 ring-indigo-500/20 shadow-xs'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50/60 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div>
                    {/* Header Row */}
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        {/* Swatch Dot */}
                        <span
                          className="w-4 h-4 rounded-full shadow-xs border border-white dark:border-slate-800 shrink-0"
                          style={{ backgroundColor: theme.primaryColor }}
                        />
                        <span className="text-sm font-bold text-slate-900 dark:text-white">
                          {theme.name}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] uppercase font-semibold tracking-wider px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                          {theme.badge}
                        </span>
                        {isSelected && (
                          <div className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0">
                            <Check className="w-3 h-3" />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Subtitle */}
                    <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      {theme.subtitle}
                    </p>

                    {/* Description */}
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                      {theme.description}
                    </p>
                  </div>

                  {/* Swatch preview bar */}
                  <div className="mt-3.5 pt-2.5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
                    <span className="text-[10px] text-slate-400 font-medium">Palette Preview</span>
                    <div className="flex items-center gap-1.5">
                      <div
                        className="w-5 h-3 rounded-sm shadow-2xs"
                        style={{ backgroundColor: theme.primaryColor }}
                        title="Primary Color"
                      />
                      <div
                        className="w-5 h-3 rounded-sm shadow-2xs"
                        style={{ backgroundColor: theme.accentColor }}
                        title="Accent Color"
                      />
                      <div
                        className="w-5 h-3 rounded-sm border border-slate-200 dark:border-slate-700"
                        style={{
                          backgroundColor:
                            theme.id === 'obsidian'
                              ? '#27272a'
                              : theme.id === 'warm'
                              ? '#fed7aa'
                              : theme.id === 'emerald'
                              ? '#a7f3d0'
                              : theme.id === 'teal'
                              ? '#99f6e4'
                              : theme.id === 'violet'
                              ? '#ddd6fe'
                              : '#c7d2fe',
                        }}
                        title="Tint / Highlight"
                      />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 bg-slate-50 dark:bg-slate-950/60 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>Theme selection persists automatically across sessions.</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
