export function validateHttpUrl(value: unknown, required = true) {
  const text = String(value ?? '').trim()
  if (!text) return required ? '网站地址不能为空' : null
  try {
    const url = new URL(text)
    if (!['http:', 'https:'].includes(url.protocol)) return '只允许 http 或 https 地址'
    if (!url.hostname || url.username || url.password) return '请输入有效的网站地址'
    return null
  } catch {
    return '请输入有效的网站地址'
  }
}

export function validateLinkUrls(url: unknown, avatar: unknown) {
  return validateHttpUrl(url, true) || validateHttpUrl(avatar, false)
}
