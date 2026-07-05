import { createRouter, createWebHistory } from 'vue-router'

// Build-mode route split (see .env.app / docs/ANDROID.md):
//   web build  (`npm run build`):      landing page + admin. No player UI.
//   app build  (`npm run build:app`):  player UI only. No admin routes.
// VITE_APP_MODE is inlined at build time, so the dead branch (and its
// dynamically imported views) is dropped from the bundle.
const IS_APP = import.meta.env.VITE_APP_MODE === 'app'

const routes = IS_APP
  ? [
      { path: '/', name: 'Home', component: () => import('../views/HomeView.vue') },
      { path: '/:pathMatch(.*)*', redirect: '/' },
    ]
  : [
      { path: '/', name: 'Landing', component: () => import('../views/LandingView.vue') },
      { path: '/admin', name: 'AdminDashboard', component: () => import('../views/AdminDashboard.vue') },
      { path: '/admin/results', name: 'AdminResults', component: () => import('../views/AdminResults.vue') },
      { path: '/:pathMatch(.*)*', redirect: '/' },
    ]

export default createRouter({
  history: createWebHistory(),
  routes
})
