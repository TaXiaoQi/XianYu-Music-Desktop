import { describe, expect, it } from 'vitest';

import source from './OnboardingModal.vue?raw';

describe('OnboardingModal splash', () => {
  it('continues when the splash is clicked anywhere', () => {
    expect(source).toContain('@click="continueFromSplash"');
    expect(source).toContain('点击任意位置以继续');
  });

  it('keeps a native window drag region available while onboarding covers the title bar', () => {
    expect(source).toContain('data-tauri-drag-region');
    expect(source).toContain('class="absolute left-1/4 right-1/4 top-0 z-[70] h-10"');
    expect(source).toContain('@click.stop');
  });

  it('keeps tall shortcut settings visible from the top at minimum window height', () => {
    expect(source).toContain('max-w-6xl mx-auto min-h-full');
    expect(source).not.toContain('max-w-6xl mx-auto h-full');
    expect(source).toContain('快捷按键');
  });

  it('automatically continues after five seconds', () => {
    expect(source).toContain('SPLASH_AUTO_ADVANCE_DELAY = 5000');
    expect(source).toContain('setTimeout(continueFromSplash, SPLASH_AUTO_ADVANCE_DELAY)');
  });

  it('does not render the old splash continue button', () => {
    expect(source.match(/@click="nextStep"/g)).toHaveLength(1);
  });

  it('selects window materials by clicking the option row without apply buttons', () => {
    expect(source).toContain("@click=\"selectWindowMaterial('none')\"");
    expect(source).toContain("@click=\"selectWindowMaterial('mica')\"");
    expect(source).toContain("@click=\"selectWindowMaterial('acrylic')\"");
    expect(source).toContain("@click=\"selectWindowMaterial('blur')\"");
    expect(source).not.toContain('@click="setMaterialToNone"');
    expect(source).not.toContain("@click=\"toggleWindowMaterial('mica')\"");
  });

  it('applies onboarding settings immediately', () => {
    expect(source).toContain('const { settings, patchSettings } = useSettings()');
    expect(source).toContain('patchSettings({ shortcuts: createDefaultShortcutSettings() })');
    expect(source).toContain('[actionId]: nextBinding');
    expect(source).toContain(':class="onboardingSurfaceClass"');
    expect(source).toContain("materialMode.value === 'none'");
  });

  it('places plugin management after shortcuts and allows deferring it', () => {
    expect(source).toContain("type Step = 'splash' | 'theme' | 'material' | 'shortcuts' | 'plugins' | 'account'");
    expect(source).toContain("['splash', 'theme', 'material', 'shortcuts', 'plugins', 'account']");
    expect(source).toContain("{ key: 'plugins', label: '插件' }");
    expect(source).toContain('添加或管理插件');
    expect(source).toContain("pluginManagerVisited ? '继续' : '稍后添加'");
    expect(source).not.toContain('sm:border-r border-black/10 dark:border-white/10');
  });

  it('lazy-loads the existing full plugin manager inside onboarding', () => {
    expect(source).toContain("() => import('../settings/SettingsPlugins.vue')");
    expect(source).toContain('<SettingsPlugins overlay-z-class="z-[10000]" />');
    expect(source).toContain('@click="closePluginManager"');
    expect(source).toContain('完成管理');
  });

  it('keeps the full plugin manager transparent without exposing the onboarding page below it', () => {
    expect(source).toContain('data-onboarding-plugin-manager-surface');
    expect(source).toContain('overflow-hidden');
    expect(source).toContain(":class=\"{ 'invisible pointer-events-none': stepContentHidden }\"");
    expect(source.match(/:class="onboardingSurfaceClass"/g)).toHaveLength(2);
  });
});
