import { invoke } from '@tauri-apps/api/core';

import type { TauriCommandMap } from './contracts';

type CommandName = keyof TauriCommandMap;
type CommandPayload<K extends CommandName> = TauriCommandMap[K]['payload'];
type CommandResponse<K extends CommandName> = TauriCommandMap[K]['response'];

export const tauriInvoke = <K extends CommandName>(
  command: K,
  payload?: CommandPayload<K>,
) =>
  invoke<CommandResponse<K>>(
    command,
    payload as Record<string, unknown> | undefined,
  );
