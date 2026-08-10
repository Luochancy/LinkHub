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
import { computed, onMounted, ref } from 'vue'
const user = ref<any>(null)
const isAdmin = ref(false)
async function load() { const data = await fetch('/api/auth/me').then(r => r.json()); user.value = data.user; isAdmin.value = Boolean(data.isAdmin) }
async function logout() { await fetch('/api/auth/logout', { method: 'POST' }); user.value = null; location.href = '/' }
onMounted(load)
</script>
