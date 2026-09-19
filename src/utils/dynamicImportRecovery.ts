export const DYNAMIC_IMPORT_RELOAD_COOLDOWN_MS = 10_000;

export const isDynamicImportFetchError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(message);
};

export interface DynamicImportRecoveryOptions {
  getLastReloadAt: () => number;
  setLastReloadAt: (value: number) => void;
  reload: () => void;
  now?: () => number;
  schedule?: (callback: () => void, delay: number) => void;
  cooldownMs?: number;
}

export const createDynamicImportRecovery = (options: DynamicImportRecoveryOptions) => {
  let recoveryScheduled = false;

  return (error: unknown) => {
    if (!isDynamicImportFetchError(error)) return false;

    if (recoveryScheduled) return true;

    const now = (options.now ?? Date.now)();
    const lastReloadAt = options.getLastReloadAt();
    const cooldownMs = options.cooldownMs ?? DYNAMIC_IMPORT_RELOAD_COOLDOWN_MS;
    if (Number.isFinite(lastReloadAt) && now - lastReloadAt < cooldownMs) {
      return false;
    }

    options.setLastReloadAt(now);
    recoveryScheduled = true;
    (options.schedule ?? ((callback, delay) => window.setTimeout(callback, delay)))(options.reload, 500);
    return true;
  };
};
