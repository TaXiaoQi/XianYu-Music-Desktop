import { describe, expect, it } from "vitest";

import { expectSourceContains, expectSourceNotContains } from "../../testing/sourceText";
import source from "./OnboardingModal.vue?raw";
import accountSource from "./steps/OnboardingAccountStep.vue?raw";
import materialSource from "./steps/OnboardingMaterialStep.vue?raw";
import pluginsSource from "./steps/OnboardingPluginsStep.vue?raw";
import shortcutsSource from "./steps/OnboardingShortcutsStep.vue?raw";
import splashSource from "./steps/OnboardingSplashStep.vue?raw";
import themeSource from "./steps/OnboardingThemeStep.vue?raw";
import onboardingStateSource from "../../composables/onboarding/useOnboardingState.ts?raw";
import shortcutCaptureSource from "../../composables/onboarding/useShortcutCapture.ts?raw";

// 拆分后的引导弹窗 = 主组件（容器/遮罩/页脚） + 步骤子组件 + 组合函数。
// 原有 raw-source 断言按代码现在所在的文件分别校验，断言内容保持不变。
const combined = [
    source,
    splashSource,
    themeSource,
    materialSource,
    shortcutsSource,
    pluginsSource,
    accountSource,
    onboardingStateSource,
    shortcutCaptureSource,
].join("\n");

describe("OnboardingModal splash", () => {
    it("continues when the splash is clicked anywhere", () => {
        expectSourceContains(splashSource, '@click="continueFromSplash"');
        expectSourceContains(splashSource, "点击任意位置以继续");
        expectSourceContains(source, '@continue="continueFromSplash"');
    });

    it("keeps a native window drag region available while onboarding covers the title bar", () => {
        expectSourceContains(source, "data-tauri-drag-region");
        expectSourceContains(
            source,
            'class="absolute left-1/4 right-1/4 top-0 z-[70] h-10"',
        );
        expectSourceContains(source, "@click.stop");
    });

    it("keeps tall shortcut settings visible from the top at minimum window height", () => {
        expectSourceContains(source, "max-w-6xl mx-auto min-h-full");
        expectSourceNotContains(source, "max-w-6xl mx-auto h-full");
        expectSourceContains(shortcutsSource, "快捷按键");
    });

    it("automatically continues after five seconds", () => {
        expectSourceContains(
            onboardingStateSource,
            "SPLASH_AUTO_ADVANCE_DELAY = 5000",
        );
        expectSourceContains(
            onboardingStateSource,
            "setTimeout(continueFromSplash, SPLASH_AUTO_ADVANCE_DELAY)",
        );
    });

    it("does not render the old splash continue button", () => {
        expect(combined.match(/@click="nextStep"/g)).toHaveLength(1);
    });

    it("selects window materials by clicking the option row without apply buttons", () => {
        expectSourceContains(materialSource, "@click=\"selectWindowMaterial('none')\"");
        expectSourceContains(materialSource, "@click=\"selectWindowMaterial('mica')\"");
        expectSourceContains(materialSource, "@click=\"selectWindowMaterial('acrylic')\"");
        expectSourceContains(materialSource, "@click=\"selectWindowMaterial('blur')\"");
        expectSourceNotContains(combined, '@click="setMaterialToNone"');
        expectSourceNotContains(combined, "@click=\"toggleWindowMaterial('mica')\"");
    });

    it("applies onboarding settings immediately", () => {
        expectSourceContains(
            shortcutCaptureSource,
            "const { settings, patchSettings } = useSettings()",
        );
        expectSourceContains(
            shortcutCaptureSource,
            "patchSettings({ shortcuts: createDefaultShortcutSettings() })",
        );
        expectSourceContains(shortcutCaptureSource, "[actionId]: nextBinding");
        expectSourceContains(source, ':class="onboardingSurfaceClass"');
        expectSourceContains(source, "materialMode.value === 'none'");
        expect(source.match(/:class="onboardingSurfaceClass"/g)).toHaveLength(2);
    });

    it("places plugin management after shortcuts and allows deferring it", () => {
        expectSourceContains(
            onboardingStateSource,
            "type Step = 'splash' | 'theme' | 'material' | 'shortcuts' | 'plugins' | 'account'",
        );
        expectSourceContains(
            onboardingStateSource,
            "['splash', 'theme', 'material', 'shortcuts', 'plugins', 'account']",
        );
        expectSourceContains(onboardingStateSource, "{ key: 'plugins', label: '插件' }");
        expectSourceContains(pluginsSource, "添加或管理插件");
        expectSourceContains(source, "pluginManagerVisited ? '继续' : '稍后添加'");
        expectSourceNotContains(
            combined,
            "sm:border-r border-black/10 dark:border-white/10",
        );
    });

    it("lazy-loads the existing full plugin manager inside onboarding", () => {
        expectSourceContains(
            source,
            "() => import('../settings/SettingsPlugins.vue')",
        );
        expectSourceContains(
            source,
            '<SettingsPlugins overlay-z-class="z-[10000]" />',
        );
        expectSourceContains(source, '@click="closePluginManager"');
        expectSourceContains(source, "完成管理");
    });

    it("keeps the full plugin manager transparent without exposing the onboarding page below it", () => {
        expectSourceContains(source, "data-onboarding-plugin-manager-surface");
        expectSourceContains(source, "overflow-hidden");
        expectSourceContains(
            source,
            ":class=\"{ 'invisible pointer-events-none': stepContentHidden }\"",
        );
        expect(source.match(/:class="onboardingSurfaceClass"/g)).toHaveLength(
            2,
        );
    });

    it("keeps step components wired to the main container", () => {
        expectSourceContains(source, '@open-manager="openPluginManager"');
        expectSourceContains(source, '@custom-select="showCustomUnsupported = true"');
        expectSourceContains(source, '@authorized="handleAuthorized"');
        expectSourceContains(accountSource, "emit('authorized')");
    });
});
