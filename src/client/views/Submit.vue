<template>
  <v-container class="py-12" max-width="720">
    <v-btn to="/" variant="text" prepend-icon="mdi-arrow-left" class="mb-6">返回</v-btn>
    <h1 class="text-h4 mb-2">申请友情链接</h1>
    <p class="text-body-1 text-medium-emphasis mb-8">提交后会写入 WordPress，等待管理员审核。</p>
    <v-card rounded="xl" border elevation="0" class="pa-6">
      <v-form @submit.prevent="submit">
        <v-text-field v-model="form.name" label="网站名称" variant="outlined" required class="mb-2" />
        <v-text-field v-model="form.url" label="网站地址" variant="outlined" type="url" :rules="[urlRule]" hint="必须是 http:// 或 https:// 开头的完整地址" persistent-hint required class="mb-2" />
        <v-text-field v-model="form.avatar" label="头像地址（可选）" variant="outlined" type="url" :rules="[avatarRule]" hint="留空则自动读取站点 favicon" persistent-hint class="mb-2" />
        <v-textarea v-model="form.description" label="网站描述" variant="outlined" rows="3" />
        <v-alert v-if="message" :type="error ? 'error' : 'success'" variant="tonal" class="mb-4">{{ message }}</v-alert>
        <v-btn type="submit" color="primary" size="large" rounded="pill" :loading="saving" block>提交申请</v-btn>
      </v-form>
    </v-card>
  </v-container>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const form = ref({ name: '', url: '', avatar: '', description: '' })
const saving = ref(false)
const error = ref(false)
const message = ref('')
function validate(value: string, required: boolean) {
  if (!value?.trim()) return required ? '请输入网站地址' : true
  try { const url = new URL(value.trim()); if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return '请输入有效的 http(s) 地址'; return true } catch { return '请输入有效的 http(s) 地址' }
}
const urlRule = (value: string) => validate(value, true)
const avatarRule = (value: string) => validate(value, false)
async function submit() {
  const urlError = validate(form.value.url, true); const avatarError = validate(form.value.avatar, false)
  if (urlError !== true || avatarError !== true) { error.value = true; message.value = urlError !== true ? String(urlError) : String(avatarError); return }
  saving.value = true; error.value = false; message.value = ''
  try {
    const response = await fetch('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form.value) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.error) throw new Error(data.error || '提交失败')
    message.value = '申请已提交，等待管理员审核'; form.value = { name: '', url: '', avatar: '', description: '' }
  } catch (e: any) { error.value = true; message.value = e.message }
  finally { saving.value = false }
}
</script>
