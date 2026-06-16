import { createRouter, createWebHistory } from 'vue-router'
import ReportView from '../views/ReportView.vue'

const routes = [
  { path: '/', redirect: '/report' },
  { path: '/report/:module?', name: 'report', component: ReportView }
]

export default createRouter({
  history: createWebHistory(),
  routes
})
