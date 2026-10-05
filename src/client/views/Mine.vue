<template>
  <v-container class="py-8 py-md-12" max-width="900">
    <div class="d-flex align-center justify-space-between mb-8">
      <div>
        <h1 class="text-h4 page-title">我的友链</h1>
        <p class="text-body-1 text-medium-emphasis mt-2">只显示 WordPress 备注中属于你的链接。</p>
      </div>
      <v-btn to="/submit" color="primary" prepend-icon="mdi-plus">申请友链</v-btn>
    </div>

    <v-alert v-if="message" :type="error ? 'error' : 'success'" variant="tonal" class="mb-4">{{ message }}</v-alert>

    <v-card v-for="link in links" :key="link.id" rounded="xl" variant="outlined" class="mb-3">
      <v-list-item :title="link.name" :subtitle="link.url">
        <template #prepend>
          <v-avatar color="primary-container">
            <v-img v-if="!failedIcons[link.id]" :src="siteIcon(link.url, link.avatar)" @error="failedIcons[link.id] = true" />
            <span v-if="failedIcons[link.id] || !siteIcon(link.url, link.avatar)">{{ link.name[0] }}</span>
          </v-avatar>
        </template>
        <template #append>
          <v-chip :color="statusColor(link.status)" variant="tonal" class="mr-2">{{ statusText(link.status) }}</v-chip>
          <v-btn icon="mdi-pencil-outline" variant="text" aria-label="编辑友链" @click="openEdit(link)" />
          <v-btn icon="mdi-delete-outline" variant="text" color="error" aria-label="删除友链" @click="remove(link)" />
        </template>
      </v-list-item>
      <v-alert
        v-if="link.syncStatus === 'failed'"
        type="warning"
        variant="tonal"
        density="compact"
        class="mx-4 mb-4"
      >
        与 WordPress 同步失败：{{ link.syncError || '未知错误' }}
      </v-alert>
    </v-card>

    <v-alert v-if="loaded && !links.length" type="info" variant="tonal" rounded="xl">
      还没有属于你的友情链接。
    </v-alert>

    <v-dialog v-model="editOpen" max-width="560">
      <v-card rounded="xl">
        <v-card-title class="pa-6">编辑友情链接</v-card-title>
        <v-card-text class="pt-0">
          <v-text-field v-model="editForm.name" label="名称" variant="outlined" class="mb-2" />
          <v-text-field v-model="editForm.url" label="网址" variant="outlined" class="mb-2" />
          <v-text-field v-model="editForm.avatar" label="图标地址（可选）" variant="outlined" class="mb-2" />
          <v-textarea v-model="editForm.description" label="简介（可选）" variant="outlined" rows="3" />
        </v-card-text>
        <v-card-actions class="pa-6 pt-0">
          <v-spacer />
          <v-btn variant="text" @click="editOpen = false">取消</v-btn>
          <v-btn color="primary" variant="tonal" :loading="saving" @click="saveEdit">保存</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="deleteOpen" max-width="460">
      <v-card rounded="xl">
        <v-card-title class="pa-6">确认删除友情链接？</v-card-title>
        <v-card-text class="pt-0">将删除「{{ deleteLink?.name }}」，此操作不可恢复。</v-card-text>
        <v-card-actions class="pa-6 pt-0">
          <v-spacer />
          <v-btn variant="text" @click="deleteOpen = false">取消</v-btn>
          <v-btn color="error" variant="tonal" :loading="deleting" @click="confirmRemove">删除</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { siteIcon } from '../icon'

const links = ref<any[]>([])
const failedIcons = reactive<Record<string, boolean>>({})
const loaded = ref(false)
const message = ref('')
const error = ref(false)
const saving = ref(false)
const deleteOpen = ref(false)
const deleting = ref(false)
const deleteLink = ref<any | null>(null)
const editOpen = ref(false)
const editForm = reactive({ id: '', name: '', url: '', avatar: '', description: '' })

function statusText(status: string) {
  return status === 'approved' ? '已公开' : status === 'rejected' ? '已隐藏' : '待审核'
}
function statusColor(status: string) {
  return status === 'approved' ? 'success' : status === 'rejected' ? 'grey' : 'warning'
}

/** 统一请求入口：网络异常返回 ok=false，避免按钮卡在 loading。 */
async function send(url: string, init?: RequestInit) {
  try {
    const response = await fetch(url, init)
    const data = await response.json().catch(() => ({}))
    return { ok: response.ok, data: data as any }
  } catch {
    return { ok: false, data: { error: '网络请求失败，请检查网络后重试' } }
  }
}
function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

onMounted(async () => {
  try {
    const { ok, data } = await send('/api/links/mine')
    if (!ok) {
      error.value = true
      message.value = data.error || '读取友链失败'
      return
    }
    links.value = data.links || []
  } finally {
    loaded.value = true
  }
})

function remove(link: any) {
  deleteLink.value = link
  deleteOpen.value = true
}

async function confirmRemove() {
  if (!deleteLink.value) return
  const target = deleteLink.value
  deleting.value = true
  try {
    const { ok, data } = await send(`/api/links/${target.id}`, { method: 'DELETE' })
    if (!ok) {
      error.value = true
      message.value = data.error || '删除失败'
      return
    }
    links.value = links.value.filter(x => x.id !== target.id)
    deleteOpen.value = false
    deleteLink.value = null
    error.value = false
    message.value = `已删除「${target.name}」`
  } finally {
    deleting.value = false
  }
}

function openEdit(link: any) {
  Object.assign(editForm, {
    id: link.id,
    name: link.name,
    url: link.url,
    avatar: link.avatar || '',
    description: link.description || ''
  })
  editOpen.value = true
}

async function saveEdit() {
  saving.value = true
  try {
    const { ok, data } = await send(`/api/links/${editForm.id}`, jsonInit('PUT', editForm))
    if (!ok) {
      error.value = true
      message.value = data.error || '保存失败'
      return
    }
    // 服务端在异常情况下可能只返回 error 而没有 link，直接写入会把列表项变成 undefined。
    if (!data.link) {
      error.value = true
      message.value = '保存失败：服务端未返回数据'
      return
    }
    const index = links.value.findIndex(x => x.id === editForm.id)
    if (index >= 0) links.value[index] = data.link
    editOpen.value = false
    if (data.link.syncStatus === 'failed') {
      error.value = true
      message.value = `本地已保存，但 WordPress 同步失败：${data.link.syncError || '未知错误'}`
    } else if (data.link.status === 'pending') {
      error.value = false
      message.value = '已保存，等待管理员重新审核。'
    } else {
      error.value = false
      message.value = '已保存。'
    }
  } finally {
    saving.value = false
  }
}
</script>
