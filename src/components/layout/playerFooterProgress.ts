type ProgressStorage = { getItem(key: string): string | null };

export interface ProgressVisualState { trackClass: string; thumbClass: string }

export const FOOTER_PROGRESS_HIDDEN_KEY =
  'footer_progress_hidden';

const STORED_TRUE_TOKEN = 'true';

const VISUAL_PRESETS = {
  revealed: { trackClass: 'opacity-100', thumbClass: 'opacity-0 scale-75 group-hover/progress:opacity-100 group-hover/progress:scale-100' },
  concealed: { trackClass: 'opacity-0 group-hover/progress:opacity-0', thumbClass: 'opacity-0 scale-75' },
  resurrected: { trackClass: 'opacity-45', thumbClass: 'opacity-70 scale-100' },
} as const satisfies Record<string, ProgressVisualState>;

export function readStoredProgressHidden(progressStorage: ProgressStorage): boolean {
  return progressStorage.getItem(FOOTER_PROGRESS_HIDDEN_KEY) === STORED_TRUE_TOKEN;
}

export function getProgressVisualState(hidden: boolean, dragging: boolean): ProgressVisualState {
  const preset = !hidden
    ? VISUAL_PRESETS.revealed
    : dragging ? VISUAL_PRESETS.resurrected : VISUAL_PRESETS.concealed;

  return { trackClass: preset.trackClass, thumbClass: preset.thumbClass };
}
