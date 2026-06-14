export const FOOTER_PROGRESS_HIDDEN_KEY = 'footer_progress_hidden';

type ProgressStorage = Pick<Storage, 'getItem'>;

export interface ProgressVisualState {
  trackClass: string;
  thumbClass: string;
}

export function readStoredProgressHidden(storage: ProgressStorage): boolean {
  return storage.getItem(FOOTER_PROGRESS_HIDDEN_KEY) === 'true';
}

export function getProgressVisualState(isHidden: boolean, isDragging: boolean): ProgressVisualState {
  if (isHidden && isDragging) {
    return {
      trackClass: 'opacity-45',
      thumbClass: 'opacity-70 scale-100'
    };
  }

  if (isHidden) {
    return {
      trackClass: 'opacity-0 group-hover/progress:opacity-0',
      thumbClass: 'opacity-0 scale-75'
    };
  }

  return {
    trackClass: 'opacity-100',
    thumbClass: 'opacity-0 scale-75 group-hover/progress:opacity-100 group-hover/progress:scale-100'
  };
}
