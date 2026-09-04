import { computed, onMounted, ref } from 'vue';

import { useThemeSettings } from './useThemeSettings';
import { useWindowMaterial, type WindowMaterialMode } from './windowMaterial';
import { useUiStore } from '../shared/stores/ui';
import { DEFAULT_THEME_COLOR, normalizeThemeColor } from '../utils/themeColor';

const clampFlowValue = (value: number) => Math.min(100, Math.max(0, Math.round(value)));
type SelectableWindowMaterialMode = Exclude<WindowMaterialMode, 'none'>;
type WindowMaterialDisabledReason = 'windows' | 'windows11' | 'transparency' | 'theme-conflict' | null;

export function useSettingsThemeControls() {
  const { theme, patchTheme, setThemeMode, setDynamicBackgroundType, setWindowMaterial } = useThemeSettings();
  const { capabilities, loadWindowMaterialCapabilities } = useWindowMaterial();
  const uiStore = useUiStore();
  const showCustomModal = computed({
    get: () => uiStore.showCustomSkinModal,
    set: (value: boolean) => { uiStore.showCustomSkinModal = value; },
  });
  const showFlowTuning = ref(false);
  const showBlurTuning = ref(false);

  const colorScheme = computed({
    get: () => theme.value.mode,
    set: (value: 'light' | 'dark' | 'custom' | 'system') => {
      setThemeMode(value);
    },
  });

  const materialMode = computed({
    get: () => theme.value.windowMaterial,
    set: (value: WindowMaterialMode) => {
      setWindowMaterial(value);
    },
  });
  const keepWindowMaterialOnBlur = computed({
    get: () => theme.value.keepWindowMaterialOnBlur,
    set: (value: boolean) => {
      patchTheme({ keepWindowMaterialOnBlur: value });
    },
  });
  const useCustomTrayMenu = computed({
    get: () => theme.value.useCustomTrayMenu,
    set: (value: boolean) => {
      patchTheme({ useCustomTrayMenu: value });
    },
  });
  const useGlassSwitch = computed({
    get: () => theme.value.useGlassSwitch ?? false,
    set: (value: boolean) => {
      patchTheme({ useGlassSwitch: value });
    },
  });
  const showLeaderboard = computed({
    get: () => theme.value.showLeaderboard,
    set: (value: boolean) => {
      patchTheme({ showLeaderboard: value });
    },
  });
  const playerDetailCoverBehavior = computed({
    get: () => theme.value.playerDetailCoverBehavior,
    set: (value: 'show' | 'hide' | 'remember') => {
      patchTheme({ playerDetailCoverBehavior: value });
    },
  });

  const isWindows11 = computed(
    () => capabilities.value.isWindows && (capabilities.value.windowsBuildNumber ?? 0) >= 22000,
  );
  const hasWindowMaterialSelected = computed(() => materialMode.value !== 'none');
  const hasWindowMaterialThemeConflict = computed(
    () => colorScheme.value === 'custom' || theme.value.dynamicBgType !== 'none',
  );
  const windowMaterialSharedDisabledReason = computed<Exclude<WindowMaterialDisabledReason, 'windows' | 'windows11'>>(() => {
    if (capabilities.value.systemTransparencyEnabled === false) {
      return 'transparency';
    }

    if (hasWindowMaterialThemeConflict.value) {
      return 'theme-conflict';
    }

    return null;
  });
  const windowMaterialDisabledReason = computed<WindowMaterialDisabledReason>(() => (
    windowMaterialSharedDisabledReason.value
      ?? (capabilities.value.isWindows ? null : 'windows')
  ));
  const isWindowMaterialDisabled = computed(() => windowMaterialDisabledReason.value !== null);
  const isDynamicBgDisabled = computed(
    () => colorScheme.value === 'custom' || hasWindowMaterialSelected.value,
  );

  const setColorScheme = (mode: 'light' | 'dark' | 'custom' | 'system') => {
    colorScheme.value = mode;
  };

  const setAccentColor = (value: string) => {
    patchTheme({ accentColor: normalizeThemeColor(value, theme.value.accentColor) });
  };

  const resetAccentColor = () => {
    patchTheme({ accentColor: DEFAULT_THEME_COLOR });
  };

  const setDynamicType = (type: 'none' | 'flow' | 'blur') => {
    if (isDynamicBgDisabled.value) {
      return;
    }

    setDynamicBackgroundType(type);
    if (type !== 'flow') {
      showFlowTuning.value = false;
    }
  };

  const getWindowMaterialModeDisabledReason = (mode: SelectableWindowMaterialMode): WindowMaterialDisabledReason => {
    if ((mode === 'acrylic' || mode === 'mica') && !isWindows11.value) {
      return 'windows11';
    }

    if (mode === 'blur' && (!capabilities.value.isWindows || !capabilities.value.supportsBlur)) {
      return 'windows';
    }

    return windowMaterialSharedDisabledReason.value;
  };

  const isWindowMaterialModeDisabled = (mode: SelectableWindowMaterialMode) => (
    getWindowMaterialModeDisabledReason(mode) !== null
  );

  const isWindowMaterialButtonDisabled = (mode: SelectableWindowMaterialMode) => (
    materialMode.value !== mode && isWindowMaterialModeDisabled(mode)
  );

  const toggleWindowMaterial = (mode: SelectableWindowMaterialMode) => {
    if (materialMode.value === mode) {
      materialMode.value = 'none';
      if (mode === 'blur') {
        showBlurTuning.value = false;
      }
      return;
    }

    if (isWindowMaterialModeDisabled(mode)) {
      return;
    }

    materialMode.value = mode;
    if (mode !== 'blur') {
      showBlurTuning.value = false;
    }
  };

  const openCustomModal = () => {
    showCustomModal.value = true;
  };

  const toggleFlowTuning = () => {
    if (isDynamicBgDisabled.value) {
      return;
    }

    if (theme.value.dynamicBgType !== 'flow') {
      setDynamicBackgroundType('flow');
      showFlowTuning.value = true;
      return;
    }

    showFlowTuning.value = !showFlowTuning.value;
  };

  const toggleBlurTuning = () => {
    if (materialMode.value !== 'blur') {
      if (isWindowMaterialModeDisabled('blur')) {
        return;
      }

      materialMode.value = 'blur';
      showBlurTuning.value = true;
      return;
    }

    showBlurTuning.value = !showBlurTuning.value;
  };

  const setFlowColorBoost = (value: number) => {
    patchTheme({ flowColorBoost: clampFlowValue(value) });
  };

  const setFlowDepth = (value: number) => {
    patchTheme({ flowDepth: clampFlowValue(value) });
  };

  const setFlowSpeed = (value: number) => {
    patchTheme({ flowSpeed: clampFlowValue(value) });
  };

  const setFlowTexture = (value: number) => {
    patchTheme({ flowTexture: clampFlowValue(value) });
  };

  const setWindowBlurTint = (value: number) => {
    patchTheme({ windowBlurTint: clampFlowValue(value) });
  };

  const setKeepWindowMaterialOnBlur = (value: boolean) => {
    keepWindowMaterialOnBlur.value = value;
  };

  const setUseCustomTrayMenu = (value: boolean) => {
    useCustomTrayMenu.value = value;
  };

  const setShowLeaderboard = (value: boolean) => {
    showLeaderboard.value = value;
  };

  const setPlayerDetailCoverBehavior = (value: 'show' | 'hide' | 'remember') => {
    playerDetailCoverBehavior.value = value;
  };

  onMounted(() => {
    void loadWindowMaterialCapabilities();
  });

  const setUseGlassSwitch = (value: boolean) => {
    useGlassSwitch.value = value;
  };

  return {
    theme,
    showCustomModal,
    colorScheme,
    materialMode,
    keepWindowMaterialOnBlur,
    useCustomTrayMenu,
    useGlassSwitch,
    showLeaderboard,
    playerDetailCoverBehavior,
    isWindows11,
    hasWindowMaterialSelected,
    isWindowMaterialDisabled,
    isWindowMaterialButtonDisabled,
    getWindowMaterialModeDisabledReason,
    windowMaterialDisabledReason,
    isDynamicBgDisabled,
    showFlowTuning,
    showBlurTuning,
    setColorScheme,
    setAccentColor,
    resetAccentColor,
    setDynamicType,
    setUseGlassSwitch,
    toggleWindowMaterial,
    openCustomModal,
    toggleFlowTuning,
    toggleBlurTuning,
    setFlowColorBoost,
    setFlowDepth,
    setFlowSpeed,
    setFlowTexture,
    setWindowBlurTint,
    setKeepWindowMaterialOnBlur,
    setUseCustomTrayMenu,
    setShowLeaderboard,
    setPlayerDetailCoverBehavior,
  };
}
