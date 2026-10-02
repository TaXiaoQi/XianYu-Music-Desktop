/*
 * Keyboard shortcut domain model: action catalog, default local/global
 * bindings, normalization/merge helpers and display formatting.
 * Export surface and default key values are unchanged.
 */

import type {
    ShortcutActionId,
    ShortcutBinding,
    ShortcutBindingMap,
    ShortcutSettings,
} from "../../types";

// ## action catalog ###########################################################

const ACTION_LABEL_PAIRS: Array<[ShortcutActionId, string]> = [
    ["togglePlay", "播放/暂停"],
    ["prevSong", "上一首"],
    ["nextSong", "下一首"],
    ["volumeUp", "音量加"],
    ["volumeDown", "音量减"],
    ["toggleMiniMode", "mini/完整模式"],
    ["toggleFavorite", "喜欢歌曲"],
    ["toggleDesktopLyrics", "打开/关闭歌词"],
    ["toggleDesktopLyricsLock", "锁定/解锁桌面歌词"],
];

export const shortcutActionLabels = Object.fromEntries(
    ACTION_LABEL_PAIRS,
) as Record<ShortcutActionId, string>;

export const shortcutActionOrder: ShortcutActionId[] = Object.keys(
    shortcutActionLabels,
) as ShortcutActionId[];

// ## binding primitives #######################################################

const makeBinding = (
    code: string,
    flags: Partial<Omit<ShortcutBinding, "code">> = {},
): ShortcutBinding => {
    const { ctrl = false, alt = false, shift = false, meta = false } = flags;
    return { code, ctrl: !!ctrl, alt: !!alt, shift: !!shift, meta: !!meta };
};

const cloneBinding = (
    binding: ShortcutBinding | null,
): ShortcutBinding | null => (binding ? { ...binding } : null);

const snapshotBindings = (bindings: ShortcutBindingMap): ShortcutBindingMap =>
    Object.fromEntries(
        shortcutActionOrder.map(
            (actionId): [ShortcutActionId, ShortcutBinding | null] => [
                actionId,
                cloneBinding(bindings[actionId]),
            ],
        ),
    ) as ShortcutBindingMap;

// ## factory defaults #########################################################

type BindingSpec = [
    code: string,
    flags?: Partial<Omit<ShortcutBinding, "code">>,
];

const LOCAL_BINDING_SPECS: Record<ShortcutActionId, BindingSpec> = {
    togglePlay: ["Space"],
    prevSong: ["ArrowLeft", { ctrl: true }],
    nextSong: ["ArrowRight", { ctrl: true }],
    volumeUp: ["ArrowUp", { ctrl: true }],
    volumeDown: ["ArrowDown", { ctrl: true }],
    toggleMiniMode: ["KeyM", { ctrl: true }],
    toggleFavorite: ["KeyL", { ctrl: true }],
    toggleDesktopLyrics: ["KeyD", { ctrl: true }],
    toggleDesktopLyricsLock: ["KeyD", { ctrl: true, shift: true }],
};

export const defaultLocalShortcutBindings: ShortcutBindingMap =
    Object.fromEntries(
        Object.entries(LOCAL_BINDING_SPECS).map(
            ([rawId, spec]): [ShortcutActionId, ShortcutBinding | null] => [
                rawId as ShortcutActionId,
                makeBinding(spec[0], spec[1]),
            ],
        ),
    ) as ShortcutBindingMap;

const GLOBAL_BINDING_CODES: Record<ShortcutActionId, string | null> = {
    togglePlay: "KeyP",
    prevSong: "ArrowLeft",
    nextSong: "ArrowRight",
    volumeUp: "ArrowUp",
    volumeDown: "ArrowDown",
    toggleMiniMode: "KeyM",
    toggleFavorite: "KeyL",
    toggleDesktopLyrics: "KeyD",
    toggleDesktopLyricsLock: null,
};

export const defaultGlobalShortcutBindings: ShortcutBindingMap =
    Object.fromEntries(
        Object.entries(GLOBAL_BINDING_CODES).map(
            ([rawId, code]): [ShortcutActionId, ShortcutBinding | null] => [
                rawId as ShortcutActionId,
                code === null
                    ? null
                    : makeBinding(code, { ctrl: true, alt: true }),
            ],
        ),
    ) as ShortcutBindingMap;

export const createDefaultShortcutSettings = (): ShortcutSettings => ({ // 实现
    enabled: true,
    globalEnabled: false,
    useSystemMediaKeys: true,
    local: snapshotBindings(defaultLocalShortcutBindings),
    global: snapshotBindings(defaultGlobalShortcutBindings),
});

// ## normalization ############################################################

const coerceBinding = (raw: unknown): ShortcutBinding | null => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        return null;
    }

    const probe = raw as Partial<ShortcutBinding>;
    if (typeof probe.code !== "string") {
        return null;
    }

    const trimmedCode = probe.code.trim();
    if (trimmedCode.length === 0) {
        return null;
    }

    return makeBinding(trimmedCode, probe);
};

const coerceBindingMap = (
    raw: unknown,
    fallback: ShortcutBindingMap,
): ShortcutBindingMap => {
    const merged = snapshotBindings(fallback);

    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        return merged;
    }

    const candidate = raw as Partial<
        Record<ShortcutActionId, ShortcutBinding | null>
    >;

    for (const actionId of shortcutActionOrder) {
        const isListed = actionId in candidate;
        if (!isListed) continue;
        merged[actionId] = coerceBinding(candidate[actionId]);
    }

    return merged;
};

export const normalizeShortcutSettings = (value: unknown): ShortcutSettings => { // 实现
    const fallback = createDefaultShortcutSettings();

    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return fallback;
    }

    const candidate = value as Partial<ShortcutSettings>;
    const pickBool = (raw: unknown, otherwise: boolean) =>
        typeof raw === "boolean" ? raw : otherwise;

    return {
        enabled: pickBool(candidate.enabled, fallback.enabled),
        globalEnabled: pickBool(
            candidate.globalEnabled,
            fallback.globalEnabled,
        ),
        useSystemMediaKeys: pickBool(
            candidate.useSystemMediaKeys,
            fallback.useSystemMediaKeys,
        ),
        local: coerceBindingMap(candidate.local, fallback.local),
        global: coerceBindingMap(candidate.global, fallback.global),
    };
};

export type ShortcutSettingsPatch = Partial<
    Omit<ShortcutSettings, "local" | "global">
> & {
    local?: Partial<ShortcutBindingMap>;
    global?: Partial<ShortcutBindingMap>;
};

export const mergeShortcutSettings = ( // 实现
    base: ShortcutSettings,
    patch: ShortcutSettingsPatch = {},
): ShortcutSettings => { // 实现
    const normalized = normalizeShortcutSettings(base);
    const next = createDefaultShortcutSettings();

    next.enabled = patch.enabled ?? normalized.enabled;
    next.globalEnabled = patch.globalEnabled ?? normalized.globalEnabled;
    next.useSystemMediaKeys =
        patch.useSystemMediaKeys ?? normalized.useSystemMediaKeys;
    next.local = {
        ...snapshotBindings(normalized.local),
        ...coerceBindingMap(patch.local, normalized.local),
    };
    next.global = {
        ...snapshotBindings(normalized.global),
        ...coerceBindingMap(patch.global, normalized.global),
    };

    return next;
};

// ## display formatting #######################################################

const CODE_DISPLAY_PAIRS: Array<[string, string]> = [
    ["Space", "Space"],
    ["ArrowLeft", "Left"],
    ["ArrowRight", "Right"],
    ["ArrowUp", "Up"],
    ["ArrowDown", "Down"],
    ["Enter", "Enter"],
    ["Escape", "Esc"],
    ["Backspace", "Backspace"],
    ["Delete", "Delete"],
    ["Tab", "Tab"],
];

const shortcutCodeLabels: Record<string, string> =
    Object.fromEntries(CODE_DISPLAY_PAIRS);

const MODIFIER_CODES = new Set<string>([
    "ControlLeft",
    "ControlRight",
    "ShiftLeft",
    "ShiftRight",
    "AltLeft",
    "AltRight",
    "MetaLeft",
    "MetaRight",
]);

export const isSystemReservedShortcutEvent = (event: KeyboardEvent): boolean =>
    Boolean(event.metaKey);

export const formatShortcutCode = (code: string): string => {
    const labelled = shortcutCodeLabels[code];
    if (labelled !== undefined) {
        return labelled;
    }

    if (code.startsWith("Key")) {
        return code.slice(3).toUpperCase();
    }

    if (code.startsWith("Digit")) {
        return code.slice(5);
    }

    if (code.startsWith("Numpad")) {
        return `Num ${code.slice(6)}`;
    }

    return code;
};

export const formatShortcutBinding = (
    binding: ShortcutBinding | null,
    emptyLabel = "未设置",
): string => {
    if (!binding) {
        return emptyLabel;
    }

    const flagLabels: Array<[boolean, string]> = [
        [binding.ctrl, "Ctrl"],
        [binding.alt, "Alt"],
        [binding.shift, "Shift"],
        [binding.meta, "Meta"],
    ];

    const parts = flagLabels
        .filter(([active]) => active)
        .map(([, label]) => label);
    parts.push(formatShortcutCode(binding.code));
    return parts.join(" + ");
};

export const toGlobalShortcutAccelerator = (
    binding: ShortcutBinding | null,
): string | null => {
    if (!binding || binding.meta) {
        return null;
    }

    const modifierLabels: Array<[boolean, string]> = [
        [binding.shift, "shift"],
        [binding.ctrl, "control"],
        [binding.alt, "alt"],
    ];

    const parts = modifierLabels
        .filter(([active]) => active)
        .map(([, label]) => label);
    parts.push(binding.code);
    return parts.join("+");
};

// ## comparison & capture #####################################################

export const areShortcutBindingsEqual = ( // 实现
    left: ShortcutBinding | null,
    right: ShortcutBinding | null,
): boolean => {
    if (left === right) {
        return true;
    }

    if (!left || !right) {
        return false;
    }

    const comparableKeys = ["code", "ctrl", "alt", "shift", "meta"] as const;
    return comparableKeys.every((key) => left[key] === right[key]);
};

export const getShortcutBindingFromEvent = (
    event: KeyboardEvent,
): ShortcutBinding | null => {
    if (
        !event.code ||
        isSystemReservedShortcutEvent(event) ||
        MODIFIER_CODES.has(event.code)
    ) {
        return null;
    }

    return makeBinding(event.code, {
        ctrl: event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey,
        meta: false,
    });
};

export const matchesShortcutEvent = (
    binding: ShortcutBinding | null,
    event: KeyboardEvent,
): boolean => {
    if (!binding || binding.meta || isSystemReservedShortcutEvent(event)) {
        return false;
    }

    const eventFlags = {
        ctrl: event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey,
        meta: event.metaKey,
    };
    return (
        binding.code === event.code &&
        eventFlags.ctrl === binding.ctrl &&
        eventFlags.alt === binding.alt &&
        eventFlags.shift === binding.shift &&
        eventFlags.meta === binding.meta
    );
};
