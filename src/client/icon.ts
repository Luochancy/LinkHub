export function siteIcon(url: string, avatar?: string) {
  if (avatar) return avatar
  try { return `${new URL(url).origin}/favicon.ico` } catch { return '' }
}
