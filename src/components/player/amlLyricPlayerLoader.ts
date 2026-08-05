import type { Component } from 'vue';

let preloadPromise: Promise<Component> | null = null;

export const loadAmlLyricPlayer = () => import('./AmlLyricPlayer.vue');

export const preloadAmlLyricPlayer = () => {
  if (!preloadPromise) {
    preloadPromise = loadAmlLyricPlayer()
      .then(module => module.default as Component)
      .catch((error) => {
        preloadPromise = null;
        throw error;
      });
  }

  return preloadPromise;
};
