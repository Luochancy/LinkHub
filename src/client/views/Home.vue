<template><v-container class="py-8 py-md-12" max-width="1200"><v-sheet color="surface-container" rounded="xl" class="pa-6 pa-md-12 mb-10"><v-row align="center"><v-col cols="12" md="8"><v-chip color="primary" variant="tonal" prepend-icon="mdi-link-variant" class="mb-4">COMMUNITY DIRECTORY</v-chip><h1 class="text-h3 text-md-h2 font-weight-bold page-title mb-4">发现值得收藏的网站</h1><p class="text-body-1 text-medium-emphasis mb-0">由社区共同维护的友情链接目录，分享值得信任的站点。</p></v-col><v-col cols="12" md="4" class="d-flex justify-md-end"><v-btn href="#links" color="primary" size="large" prepend-icon="mdi-arrow-down" rounded="pill">浏览友链</v-btn></v-col></v-row></v-sheet><div id="links" class="d-flex align-center justify-space-between mb-4"><div><h2 class="text-h5 font-weight-bold">公开链接</h2><p class="text-body-2 text-medium-emphasis mt-1">{{ links.length }} 个社区站点</p></div></div><v-row><v-col v-for="link in links" :key="link.id" cols="12" sm="6" md="4" lg="3"><v-card :href="link.url" target="_blank" rounded="xl" variant="outlined" class="pa-2 h-100"><v-card-item><template #prepend><v-avatar color="primary-container" rounded="lg"><v-img v-if="!failedIcons[link.id]" :src="siteIcon(link.url, link.avatar)" @error="failedIcons[link.id] = true" /><span v-if="failedIcons[link.id] || !siteIcon(link.url, link.avatar)" class="text-h6">{{ (link.name || "?").charAt(0) }}</span></v-avatar></template><v-card-title>{{ link.name }}</v-card-title><v-card-subtitle>{{ link.ownerLogin || '社区友链' }}</v-card-subtitle></v-card-item><v-card-text class="text-medium-emphasis">{{ link.description || '暂无描述' }}</v-card-text><v-card-actions><v-spacer/><v-btn variant="tonal" color="primary" append-icon="mdi-open-in-new">访问</v-btn></v-card-actions></v-card></v-col></v-row><v-alert v-if="loadError" type="error" variant="tonal" rounded="xl" class="mt-8">{{ loadError }}</v-alert><v-alert v-else-if="!loading && !links.length" type="info" variant="tonal" rounded="xl" class="mt-8">暂无已公开的友情链接。</v-alert></v-container></template>
<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { siteIcon } from '../icon'

interface PublicLink { id: number | string; name?: string; url: string; description?: string; avatar?: string; ownerLogin?: string }

const links = ref<PublicLink[]>([])
const failedIcons = reactive<Record<string, boolean>>({})
const loading = ref(true)
const loadError = ref('')

onMounted(async () => {
  try {
    const response = await fetch('/api/links', { headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    if (!Array.isArray(data?.links)) throw new Error('unexpected /api/links shape')
    links.value = data.links
  } catch {
    // Previously this was an unguarded `.then(r => r.json())` inside try/finally,
    // so a network failure or a malformed body surfaced as an unhandled rejection
    // while the page simply showed the "no links yet" state — indistinguishable
    // from a genuinely empty directory.
    loadError.value = '友链加载失败，请稍后重试。'
  } finally {
    loading.value = false
  }
})
</script>
