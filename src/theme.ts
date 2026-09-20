import { ThemeOption, ThemeId } from './types';

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'indigo',
    name: 'Indigo',
    tagline: 'Balanced default',
    primaryColor: '#4f46e5',
    accentColor: '#6366f1',
  },
  {
    id: 'teal',
    name: 'Teal',
    tagline: 'Cool and high contrast',
    primaryColor: '#0d9488',
    accentColor: '#14b8a6',
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    tagline: 'Monochrome, for reading transcripts',
    primaryColor: '#3f3f46',
    accentColor: '#71717a',
  },
];

export const DEFAULT_THEME: ThemeId = 'indigo';

export const THEME_IDS = THEME_OPTIONS.map((t) => t.id) as ThemeId[];

/** Themes that used to exist, mapped onto the ones that survived, so saved prefs don't break. */
const LEGACY_THEME_MAP: Record<string, ThemeId> = {
  warm: 'indigo',
  emerald: 'teal',
  violet: 'indigo',
};

export function normalizeThemeId(value: string | null | undefined): ThemeId {
  if (!value) return DEFAULT_THEME;
  if ((THEME_IDS as string[]).includes(value)) return value as ThemeId;
  return LEGACY_THEME_MAP[value] || DEFAULT_THEME;
}
