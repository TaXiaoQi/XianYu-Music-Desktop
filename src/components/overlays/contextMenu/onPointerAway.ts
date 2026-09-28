import { onMounted, onUnmounted } from 'vue';

/**
 * 监听 window 上的按下动作，是否视为“点在菜单外”由调用方的 decide 决定，
 * 命中后执行 react。组件卸载时自动移除监听。
 */
export const watchPointerAway = (
  decide: (hit: EventTarget | null) => boolean,
  react: () => void,
) => {
  const onPress = (down: MouseEvent) => {
    if (decide(down.target)) {
      react();
    }
  };

  onMounted(() => window.addEventListener('mousedown', onPress));
  onUnmounted(() => window.removeEventListener('mousedown', onPress));
};
