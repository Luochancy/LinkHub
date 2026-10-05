<template>
  <v-container class="py-10 admin-page" max-width="1100">
    <div class="d-flex flex-wrap align-center justify-space-between ga-4 mb-2">
      <div>
        <h1 class="text-h4 font-weight-bold">友链管理</h1>
        <p class="text-body-1 text-medium-emphasis mt-2">审核申请、认领旧链接、编辑内容并同步回 WordPress。</p>
      </div>
      <v-btn color="primary" rounded="pill" prepend-icon="mdi-database-import" :loading="importing" @click="importLinks">从 WordPress 导入</v-btn>
    </div>

    <v-alert v-if="message" :type="error ? 'error' : 'success'" variant="tonal" class="my-5">{{ message }}</v-alert>

    <v-row class="mb-4 stats-row">
      <v-col cols="12" sm="4"><v-card rounded="xl" border elevation="0" class="pa-4"><div class="text-caption text-medium-emphasis">全部链接</div><div class="text-h5 font-weight-bold">{{ links.length }}</div></v-card></v-col>
      <v-col cols="12" sm="4"><v-card rounded="xl" border elevation="0" class="pa-4"><div class="text-caption text-medium-emphasis">待审核</div><div class="text-h5 font-weight-bold text-warning">{{ pending.length }}</div></v-card></v-col>
      <v-col cols="12" sm="4"><v-card rounded="xl" border elevation="0" class="pa-4"><div class="text-caption text-medium-emphasis">无主站点</div><div class="text-h5 font-weight-bold text-info">{{ unowned.length }}</div></v-card></v-col>
    </v-row>

    <v-card rounded="lg" color="surface-container" variant="flat" class="pa-3 pa-sm-4 mb-8 filters-card">
      <v-row align="center">
        <v-col cols="12" md="7"><v-text-field v-model="query" label="搜索名称、网址或 GitHub ID" prepend-inner-icon="mdi-magnify" hide-details clearable /></v-col>
        <v-col cols="12" md="5"><v-select v-model="statusFilter" :items="statusItems" label="状态筛选" hide-details /></v-col>
      </v-row>
    </v-card>

    <div class="d-flex align-center justify-space-between mb-3">
      <h2 class="text-h6">链接列表</h2>
      <v-btn variant="text" prepend-icon="mdi-refresh" :loading="loading" @click="load">刷新</v-btn>
    </div>
    <v-card v-if="filteredLinks.length" color="surface-container-low" variant="flat" rounded="lg" class="links-card">
      <v-list lines="two" bg-color="transparent" class="py-0">
        <v-list-item v-for="link in filteredLinks" :key="link.id" :title="link.name" :subtitle="`${link.url} · ${link.ownerLogin || link.ownerGithubId || '无主站点'}`">
          <template #prepend><v-avatar color="primary-container" rounded="lg" class="mr-3"><v-img v-if="!failedIcons[link.id]" :src="siteIcon(link.url, link.avatar)" @error="failedIcons[link.id] = true" /><span v-if="failedIcons[link.id] || !siteIcon(link.url, link.avatar)">{{ link.name?.[0] || '?' }}</span></v-avatar></template>
          <template #append>
            <v-chip size="small" :color="statusColor(link.status)" variant="tonal" class="mr-2">{{ statusText(link.status) }}</v-chip>
            <v-btn icon="mdi-pencil-outline" variant="text" @click="openEdit(link)" />
            <v-btn v-if="link.status === 'pending'" icon="mdi-check" color="success" variant="text" title="通过" @click="decide(link, true)" />
            <v-btn v-if="link.status === 'rejected'" icon="mdi-eye-outline" color="success" variant="text" title="公开" @click="decide(link, true)" />
            <v-btn v-if="link.status === 'approved'" icon="mdi-eye-off-outline" color="warning" variant="text" title="隐藏" @click="decide(link, false)" />
            <v-btn icon="mdi-delete-outline" color="error" variant="text" title="删除" @click="removeLink(link)" />
          </template>
        </v-list-item>
      </v-list>
    </v-card>
    <v-alert v-else type="info" variant="tonal" rounded="xl">没有符合条件的链接。</v-alert>

    <v-dialog v-model="deleteOpen" max-width="480">
      <v-card rounded="xl">
        <v-card-title class="pa-6">确认删除友情链接？</v-card-title>
        <v-card-text class="pt-0 text-body-1">{{ deleteLink ? `将删除「${deleteLink.name}」，同时同步删除 WordPress 中的友情链接。` : '' }}</v-card-text>
        <v-card-actions class="pa-6 pt-0"><v-spacer /><v-btn variant="text" @click="deleteOpen = false">取消</v-btn><v-btn color="error" variant="tonal" :loading="deleting" @click="confirmRemove">删除</v-btn></v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="editOpen" max-width="620">
      <v-card rounded="xl">
        <v-card-title class="pa-6">编辑友情链接</v-card-title>
        <v-card-text class="pt-0">
          <v-text-field v-model="editForm.name" label="站点名称" class="mb-2" />
          <v-text-field v-model="editForm.url" label="站点 URL" class="mb-2" />
          <v-text-field v-model="editForm.avatar" label="站点 icon URL（留空自动使用 /favicon.ico）" class="mb-2" />
          <v-text-field v-model="editForm.githubId" label="所有者 GitHub ID（留空解除绑定）" class="mb-2" />
          <v-textarea v-model="editForm.description" label="描述" rows="3" />
        </v-card-text>
        <v-card-actions class="pa-6 pt-0"><v-spacer /><v-btn variant="text" @click="editOpen = false">取消</v-btn><v-btn color="primary" rounded="pill" :loading="saving" @click="saveEdit">保存并同步</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { siteIcon } from '../icon'

const links = ref<any[]>([])
const loading = ref(false)
const importing = ref(false)
const saving = ref(false)
const editOpen = ref(false)
const deleteOpen = ref(false)
const deleting = ref(false)
const deleteLink = ref<any | null>(null)
const query = ref('')
const statusFilter = ref('all')
const message = ref('')
const error = ref(false)
const failedIcons = reactive<Record<string, boolean>>({})
const editForm = reactive({ id: '', name: '', url: '', avatar: '', githubId: '', description: '' })
const statusItems = [{ title: '全部状态', value: 'all' }, { title: '已公开', value: 'approved' }, { title: '待审核', value: 'pending' }, { title: '已隐藏', value: 'rejected' }]
const pending = computed(() => links.value.filter(link => link.status === 'pending'))
const unowned = computed(() => links.value.filter(link => link.source === 'wordpress-import' && !link.ownerGithubId))
const filteredLinks = computed(() => links.value.filter(link => {
  const text = `${link.name} ${link.url} ${link.ownerGithubId || ''} ${link.ownerLogin || ''}`.toLowerCase()
  return (statusFilter.value === 'all' || link.status === statusFilter.value) && (!query.value || text.includes(query.value.toLowerCase()))
}))

/**
 * 统一请求入口：网络异常返回 ok=false 而不是抛出，
 * 否则按钮会一直卡在 loading 状态。
 */
async function send(url: string, init?: RequestInit) {
  try {
    const response = await fetch(url, init)
    const data = await response.json().catch(() => ({}))
    return { ok: response.ok, data: data as any }
  } catch {
    return { ok: false, data: { error: '网络请求失败，请检查网络后重试' } }
  }
}
function jsonInit(method: string, body?: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }
}

async function load(clearMessage = true) {
  loading.value = true
  try {
    const { ok, data } = await send('/api/admin/links')
    if (!ok) { error.value = true; message.value = data.error || '读取管理数据失败'; return }
    links.value = data.links || []
    if (clearMessage) { message.value = ''; error.value = false }
  } finally {
    loading.value = false
  }
}

async function importLinks() {
  importing.value = true
  try {
    const { ok, data } = await send('/api/admin/import', { method: 'POST' })
    error.value = !ok
    message.value = ok
      ? `导入完成：发现 ${data.total} 条，新增 ${data.added} 条，更新 ${data.updated || 0} 条，跳过 ${data.skipped || 0} 条`
      : (data.error || '导入失败')
  } finally {
    importing.value = false
  }
  await load(false)
}

async function decide(link: any, visible: boolean) {
  const { ok, data } = await send(`/api/admin/${link.id}/visibility`, jsonInit('POST', { visible }))
  if (!ok) { error.value = true; message.value = data.error || '操作失败'; return }
  await load(false)
  if (data.link?.syncStatus === 'failed') { error.value = true; message.value = `状态已保存，但 WordPress 同步失败：${data.link.syncError || ''}` }
  else { error.value = false; message.value = visible ? '链接已通过并同步到 WordPress' : '链接已隐藏' }
}

function removeLink(link: any) { deleteLink.value = link; deleteOpen.value = true }

async function confirmRemove() {
  if (!deleteLink.value) return
  const link = deleteLink.value
  deleting.value = true
  try {
    const { ok, data } = await send(`/api/admin/${link.id}`, { method: 'DELETE' })
    if (!ok) { error.value = true; message.value = data.error || '删除失败'; return }
    deleteOpen.value = false
    deleteLink.value = null
    error.value = false
    message.value = `已删除「${link.name}」`
  } finally {
    deleting.value = false
  }
  await load(false)
}

function openEdit(link: any) { Object.assign(editForm, { id: link.id, name: link.name, url: link.url, avatar: link.avatar || '', githubId: link.ownerGithubId || '', description: link.description || '' }); editOpen.value = true }

async function saveEdit() {
  saving.value = true
  try {
    const { ok, data } = await send(`/api/admin/${editForm.id}`, jsonInit('PUT', editForm))
    if (!ok) { error.value = true; message.value = data.error || '保存失败'; return }
    if (!data.link) { error.value = true; message.value = '保存失败：服务端未返回数据'; return }
    editOpen.value = false
    if (data.link.syncStatus === 'failed') { error.value = true; message.value = `本地已保存，但 WordPress 同步失败：${data.link.syncError || ''}` }
    else { error.value = false; message.value = '已保存并同步到 WordPress' }
  } finally {
    saving.value = false
  }
  await load(false)
}

function statusText(status: string) { return status === 'approved' ? '已公开' : status === 'pending' ? '待审核' : '已隐藏' }
function statusColor(status: string) { return status === 'approved' ? 'success' : status === 'pending' ? 'warning' : 'grey' }
onMounted(load)
</script>

