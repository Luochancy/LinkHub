<template>
  <v-app>
    <v-app-bar color="surface" elevation="0" border="bottom" class="px-2 px-sm-6">
      <RouterLink to="/" class="app-brand-link" aria-label="返回 Link Hub 主页">
        <v-app-bar-title class="font-weight-bold flex-grow-0 flex-shrink-1 text-truncate app-brand"><img src="/favicon.svg" alt="" class="brand-icon" />Link Hub</v-app-bar-title>
      </RouterLink>
      <v-spacer />
      <v-chip v-if="user" class="app-user mr-2 mr-sm-4 d-none d-sm-flex" size="small" color="secondary" variant="tonal">{{ user.login }} · ID {{ user.id }}</v-chip>
      <v-btn v-if="user" to="/mine" variant="text" prepend-icon="mdi-account-circle-outline">我的友链</v-btn>
      <v-btn v-if="user && isAdmin" to="/admin" variant="text" prepend-icon="mdi-shield-check-outline">审核</v-btn>
      <v-btn v-if="user" icon="mdi-logout" variant="text" aria-label="退出登录" @click="logout" />
      <v-btn v-else to="/login" color="primary" variant="tonal" prepend-icon="mdi-github">GitHub 登录</v-btn>
    </v-app-bar>
    <v-main><router-view /></v-main>
  </v-app>
</template>
<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { consumeRedirect, currentUser, isAdminUser, loadAuth, logout as clearSession } from './auth'

const user = currentUser
const isAdmin = isAdminUser
const router = useRouter()

async function logout () {
  await clearSession()
  // Full reload drops any cached view state belonging to the old session.
  location.href = '/'
}

onMounted(async () => {
  await loadAuth()
  await router.isReady()
  // The OAuth callback always lands on `/`; forward the user to wherever they
  // were headed before signing in. Consuming only here (after a *successful*
  // auth and only on the landing route) matters: consuming earlier discarded the
  // destination whenever the session was still unknown — e.g. refreshing /login,
  // or an auth request failing on the OAuth return — and would also hijack an
  // explicit navigation to another route.
  if (currentUser.value && router.currentRoute.value.path === '/') {
    const target = consumeRedirect()
    if (target) await router.replace(target)
  }
})
</script>
