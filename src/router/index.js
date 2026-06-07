import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import AdminDashboard from '../views/AdminDashboard.vue'
import AdminResults from '../views/AdminResults.vue'

const routes = [
  { path: '/', name: 'Home', component: HomeView },
  { path: '/admin', name: 'AdminDashboard', component: AdminDashboard },
  { path: '/admin/results', name: 'AdminResults', component: AdminResults }
]

export default createRouter({
  history: createWebHistory(),
  routes
})
