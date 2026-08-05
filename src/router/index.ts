import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';

import { useOnboarding } from '../composables/useOnboarding';
import {
  INITIALIZATION_ROUTE_NAME,
} from '../composables/onboardingState';
import { installOnboardingRouteGate } from './onboardingRouteGate';

// 使用路由懒加载优化首屏加载速度
const Home = () => import('../views/Home.vue');
const Favorites = () => import('../views/Favorites.vue');
const Recent = () => import('../views/Recent.vue');
const Artists = () => import('../views/Artists.vue');
const Albums = () => import('../views/Albums.vue');
const Plugins = () => import('../views/Plugins.vue');
const Settings = () => import('../views/Settings.vue');
const Auth = () => import('../views/Auth.vue');
const Search = () => import('../views/Search.vue');
const OnlineDetail = () => import('../views/OnlineDetailView.vue');
const InitializationView = defineComponent({
  name: 'InitializationView',
  render: () => null,
});

const routes: Array<RouteRecordRaw> = [
  { path: '/initialization', name: INITIALIZATION_ROUTE_NAME, component: InitializationView },
  { path: '/', name: 'Home', component: Home, meta: { keepAlive: true } },
  { path: '/favorites', name: 'Favorites', component: Favorites },
  { path: '/recent', name: 'Recent', component: Recent },
  { path: '/artists', name: 'Artists', component: Artists },
  { path: '/albums', name: 'Albums', component: Albums },
  { path: '/plugins', name: 'Plugins', component: Plugins },
  { path: '/settings', name: 'Settings', component: Settings },
  { path: '/auth', name: 'Auth', component: Auth },
  { path: '/search', name: 'Search', component: Search },
  { path: '/online-detail', name: 'OnlineDetail', component: OnlineDetail },
];

const router = createRouter({
  history: typeof window === 'undefined' ? createMemoryHistory() : createWebHistory(),
  routes,
});

const { showOnboarding } = useOnboarding();
installOnboardingRouteGate(router, showOnboarding);

export default router;
