import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import AdminDashboard from '../views/AdminDashboard.vue'

const routes = [
  { path: '/', name: 'Home', component: HomeView },
  { path: '/admin', name: 'AdminDashboard', component: AdminDashboard }
]

export default createRouter({
  history: createWebHistory(),
  routes
})
