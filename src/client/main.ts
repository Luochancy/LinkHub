import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import 'vuetify/styles'
import './styles.css'
import { createVuetify } from 'vuetify'
import { mdi } from './icons'
import { isAdminUser, loadAuth, currentUser, rememberRedirect } from './auth'
import App from './App.vue'
import Home from './views/Home.vue'
import Login from './views/Login.vue'
import Mine from './views/Mine.vue'
import Submit from './views/Submit.vue'
import Admin from './views/Admin.vue'

const router = createRouter({ history: createWebHistory(), routes: [
  { path: '/', component: Home }, { path: '/login', component: Login },
  { path: '/mine', component: Mine, meta: { auth: true } },
  { path: '/submit', component: Submit, meta: { auth: true } },
  { path: '/admin', component: Admin, meta: { auth: true, admin: true } }
]})

// These routes declared `meta.auth`, but nothing enforced it: the flags were dead
// metadata and protected views mounted before the session was known, so a signed-out
// visitor briefly saw an empty page (and /admin rendered for non-admins before its
// own fetch failed). Resolving the session here fixes both; because loadAuth()
// de-duplicates in-flight calls this costs no extra round trip.
router.beforeEach(async (to) => {
  if (!to.meta.auth) return true
  await loadAuth()
  if (!currentUser.value) {
    // The OAuth callback always returns to `/`, so the intended destination is
    // stashed in sessionStorage rather than passed as a query parameter.
    rememberRedirect(to.fullPath)
    return { path: '/login' }
  }
  if (to.meta.admin && !isAdminUser.value) return { path: '/' }
  return true
})

const vuetify = createVuetify({
  icons: {
    defaultSet: 'mdi',
    sets: { mdi }
  },
  theme: {
    defaultTheme: 'light',
    themes: {
      light: {
        dark: false,
        colors: {
          primary: '#6750A4', 'on-primary': '#FFFFFF', 'primary-container': '#EADDFF', 'on-primary-container': '#21005D',
          secondary: '#625B71', 'on-secondary': '#FFFFFF', 'secondary-container': '#E8DEF8', 'on-secondary-container': '#1D192B',
          tertiary: '#7D5260', 'on-tertiary': '#FFFFFF', 'tertiary-container': '#FFD8E4', 'on-tertiary-container': '#31111D',
          error: '#B3261E', 'on-error': '#FFFFFF', 'error-container': '#F9DEDC', 'on-error-container': '#410E0B',
          background: '#FFFBFE', 'on-background': '#1C1B1F', surface: '#FFFBFE', 'on-surface': '#1C1B1F',
          'surface-variant': '#E7E0EC', 'on-surface-variant': '#49454F', outline: '#79747E', 'outline-variant': '#CAC4D0',
          'surface-container': '#F3EDF7', 'surface-container-high': '#ECE6F0', 'surface-container-highest': '#E6E0E9',
          'inverse-surface': '#313033', 'inverse-on-surface': '#F4EFF4', 'inverse-primary': '#D0BCFF'
        }, variables: { 'border-radius-root': '12px', 'font-family': 'Roboto, Noto Sans SC, Microsoft YaHei, sans-serif' }
      },
      dark: {
        dark: true,
        colors: {
          primary: '#D0BCFF', 'on-primary': '#381E72', 'primary-container': '#4F378B', 'on-primary-container': '#EADDFF',
          secondary: '#CCC2DC', 'on-secondary': '#332D41', 'secondary-container': '#4A4458', 'on-secondary-container': '#E8DEF8',
          tertiary: '#EFB8C8', 'on-tertiary': '#492532', 'tertiary-container': '#633B48', 'on-tertiary-container': '#FFD8E4',
          error: '#F2B8B5', 'on-error': '#601410', 'error-container': '#8C1D18', 'on-error-container': '#F9DEDC',
          background: '#141218', 'on-background': '#E6E1E5', surface: '#141218', 'on-surface': '#E6E1E5',
          'surface-variant': '#49454F', 'on-surface-variant': '#CAC4D0', outline: '#938F99', 'outline-variant': '#49454F',
          'surface-container': '#211F26', 'surface-container-high': '#2B2930', 'surface-container-highest': '#36343B',
          'inverse-surface': '#E6E1E5', 'inverse-on-surface': '#313033', 'inverse-primary': '#6750A4'
        }, variables: { 'border-radius-root': '12px', 'font-family': 'Roboto, Noto Sans SC, Microsoft YaHei, sans-serif' }
      }
    }
  },
  defaults: {
    VAppBar: { height: 64, elevation: 0 },
    VBtn: { elevation: 0, rounded: 'pill' },
    VCard: { elevation: 0 },
    VTextField: { density: 'comfortable', variant: 'outlined' },
    VSelect: { density: 'comfortable', variant: 'outlined' },
    VTextarea: { density: 'comfortable', variant: 'outlined' }
  }
})
createApp(App).use(router).use(vuetify).mount('#app')