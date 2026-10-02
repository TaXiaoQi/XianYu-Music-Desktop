import { defineComponent } from 'vue'; // 实现
import { createMemoryHistory, createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';

import { useOnboarding } from '../composables/useOnboarding'; // 实现
import {
  INITIALIZATION_ROUTE_NAME, // 实现
} from '../composables/onboardingState'; // 实现
import { installOnboardingRouteGate } from './onboardingRouteGate'; // 实现

const Home = () => import('../views/Home.vue'); // 实现
const Favorites = () => import('../views/Favorites.vue'); // 实现
const Recent = () => import('../views/Recent.vue'); // 实现
const Artists = () => import('../views/Artists.vue'); // 实现
const Albums = () => import('../views/Albums.vue'); // 实现
const Plugins = () => import('../views/Plugins.vue');
const Settings = () => import('../views/Settings.vue'); // 实现
const Auth = () => import('../views/Auth.vue'); // 实现
const Search = () => import('../views/Search.vue'); // 实现
const OnlineDetail = () => import('../views/OnlineDetailView.vue');
const InitializationView = defineComponent({ // 实现
  name: 'InitializationView', // 实现
  render: () => null, // 实现
});

const routes: Array<RouteRecordRaw> = [ // 实现
  { path: '/initialization', name: INITIALIZATION_ROUTE_NAME, component: InitializationView }, // 实现
  { path: '/', name: 'Home', component: Home },
  { path: '/favorites', name: 'Favorites', component: Favorites }, // 实现
  { path: '/recent', name: 'Recent', component: Recent }, // 实现
  { path: '/artists', name: 'Artists', component: Artists }, // 实现
  { path: '/albums', name: 'Albums', component: Albums }, // 实现
  { path: '/plugins', name: 'Plugins', component: Plugins },
  { path: '/settings', name: 'Settings', component: Settings }, // 实现
  { path: '/auth', name: 'Auth', component: Auth }, // 实现
  { path: '/search', name: 'Search', component: Search }, // 实现
  { path: '/online-detail', name: 'OnlineDetail', component: OnlineDetail },
];

const router = createRouter({ // 实现
  history: typeof window === 'undefined' ? createMemoryHistory() : createWebHistory(),
  routes,
});

const { showOnboarding } = useOnboarding(); // 实现
installOnboardingRouteGate(router, showOnboarding); // 实现

export default router; // 实现
