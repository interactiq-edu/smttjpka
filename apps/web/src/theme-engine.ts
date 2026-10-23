import type { QuizTheme } from '@interactiq/contracts';

export interface ThemeDefinition {
  id: QuizTheme;
  label: string;
  note: string;
  icon: string;
  tier: 'classic' | 'premium';
  adminLayout?: 'glasswave';
}

/** One registry drives the admin studio, resource editor, and student presentation. */
export const themeRegistry: readonly ThemeDefinition[] = [
  { id: 'AURORA', label: 'Aurora Bloom', note: 'Soft animated colour waves', icon: '✦', tier: 'classic' },
  { id: 'OCEAN', label: 'Ocean Quest', note: 'Calm blue depth and bubbles', icon: '◉', tier: 'classic' },
  { id: 'SUNSET', label: 'Sunset Pop', note: 'Warm playful gradients', icon: '☀', tier: 'classic' },
  { id: 'FOREST', label: 'Forest Trail', note: 'Fresh green discovery', icon: '✿', tier: 'classic' },
  { id: 'GALAXY', label: 'Galaxy Mission', note: 'Stars and deep space', icon: '✧', tier: 'classic' },
  { id: 'CANDY', label: 'Candy Lab', note: 'Friendly colourful shapes', icon: '●', tier: 'classic' },
  { id: 'NEON', label: 'Neon Arcade', note: 'Energetic game glow', icon: '⚡', tier: 'classic' },
  { id: 'PAPER', label: 'Paper Studio', note: 'Clean classroom style', icon: '▤', tier: 'classic' },
  { id: 'SAFARI', label: 'Safari Adventure', note: 'Warm nature patterns', icon: '◇', tier: 'classic' },
  { id: 'MIDNIGHT', label: 'Midnight Focus', note: 'Dark distraction-free mode', icon: '☾', tier: 'classic' },
  { id: 'GLASSWAVE_LEARN', label: 'GlassWave Learn', note: 'Luminous glass, cool blue waves and gentle motion', icon: '✺', tier: 'premium', adminLayout: 'glasswave' },
] as const;

export const themeClass = (themeId: QuizTheme): string => `theme-${themeId.toLowerCase().replaceAll('_', '-')}`;

export const themeLabel = (themeId: QuizTheme): string => themeRegistry.find((theme) => theme.id === themeId)?.label ?? themeId;

export const adminLayoutFor = (themeId: QuizTheme): 'classic' | 'glasswave' =>
  themeRegistry.find((theme) => theme.id === themeId)?.adminLayout ?? 'classic';
