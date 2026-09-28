// 前端 → Rust 后端命令调用的统一收口层。
// 命令名与「入参 / 返回值」形状统一登记在 contracts.ts 的命令映射表里，
// 本模块不做任何业务加工，只负责把调用原样递交给 Tauri IPC。
import { invoke as callRust } from '@tauri-apps/api/core';

import type { TauriCommandMap as CommandContract } from './contracts';

type Command = keyof CommandContract;
type CommandInput<C extends Command> = CommandContract[C]['payload'];
type CommandOutput<C extends Command> = CommandContract[C]['response'];

/**
 * 发起一次类型安全的后端命令调用。
 *
 * @param command 命令名，必须已登记在命令映射表中
 * @param payload 命令入参；无参命令可整体省略
 */
export function tauriInvoke<C extends Command>(
  command: C,
  payload?: CommandInput<C>,
): Promise<CommandOutput<C>> {
  // IPC 层只接受 Record 形态的参数表；undefined 即无参命令。
  const args = payload as Record<string, unknown> | undefined;

  return callRust<CommandOutput<C>>(command, args);
}
