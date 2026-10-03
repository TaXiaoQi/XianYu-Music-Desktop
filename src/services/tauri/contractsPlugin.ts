// ===== 插件基础设施类型契约 =====

export interface PluginHttpResponseContract {
  status: number;
  url: string;
  headers: Record<string, string>;
  body: string;
}

// ===== QuickJS 插件引擎类型契约（与 Rust plugin_host 对应）=====

export interface PluginEngineLogContract {
  level: string;
  message: string;
  callId: number;
}

export interface PluginEngineLoadResultContract {
  ok: boolean;
  error: string | null;
  metadata: any | null;
  logs: PluginEngineLogContract[];
}

export interface PluginEngineCallResultContract {
  ok: boolean;
  error: string | null;
  data: any;
  logs: PluginEngineLogContract[];
}

export interface PluginHttpBinaryResponseContract {
  status: number;
  url: string;
  headers: Record<string, string>;
  body_base64: string;
}

// ===== 兜底模块宿主类型契约（与 Rust fallback_host 对应）=====

export interface FallbackLogContract {
  level: string;
  message: string;
  callId: number;
}

export interface FallbackLoadResultContract {
  ok: boolean;
  error: string | null;
  version: number | null;
  logs: FallbackLogContract[];
}

export interface FallbackCallResultContract {
  ok: boolean;
  error: string | null;
  data: any;
  logs: FallbackLogContract[];
}

export interface FallbackCallItemContract {
  ok: boolean;
  error: string | null;
  data: any;
}

export interface FallbackCallManyResultContract {
  results: FallbackCallItemContract[];
  logs: FallbackLogContract[];
}

// ===== VST3/CLAP 原生插件宿主类型契约（与 Rust plugin_host 对应）=====

export interface PluginHostScanEntry {
  format: string;
  uniqueId: string;
  name: string;
  vendor: string;
  version: number;
  category: string;
  path: string;
  hasEditor: boolean;
  acceptsMidi: boolean;
}

export interface PluginHostRackSlotConfig {
  format: string;
  uniqueId: string;
  path: string;
  name: string;
  vendor: string;
  enabled: boolean;
  params: Record<string, number>;
}

export interface PluginHostRackConfig {
  masterEnabled: boolean;
  slots: PluginHostRackSlotConfig[];
}

export interface PluginHostParameterEntry {
  index: number;
  id: number;
  name: string;
  unit: string;
  min: number;
  max: number;
  default: number;
  stepCount: number;
  isBypass: boolean;
  automatable: boolean;
  hidden: boolean;
  readOnly: boolean;
}

export interface PluginHostParameterValueEntry {
  index: number;
  id: number;
  value: number;
  text: string;
}

export interface PluginHostPresetEntry {
  index: number;
  name: string;
  presetNumber: number;
}

export interface PluginHostEditorStateEntry {
  format: string;
  uniqueId: string;
}
