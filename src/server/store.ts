export type LinkRecord = {
  id: string
  wpId?: number
  name: string
  url: string
  description: string
  avatar: string
  ownerGithubId: string | null
  ownerLogin?: string
  status: 'pending' | 'approved' | 'rejected'
  source: 'application' | 'wordpress-import'
  syncStatus: 'pending' | 'synced' | 'failed'
  createdAt: number
  updatedAt: number
  ownerAssignedAt?: number
  ownerAssignedBy?: string
  syncError?: string
}

export type LinkStore = {
  list(): Promise<LinkRecord[]>
  put(link: LinkRecord): Promise<void>
  delete(id: string): Promise<void>
}

export function makeLink(data: Partial<LinkRecord> & Pick<LinkRecord, 'name' | 'url'>): LinkRecord {
  const now = Date.now()
  return { id: data.id || crypto.randomUUID(), name: data.name, url: data.url, description: data.description || '', avatar: data.avatar || '', ownerGithubId: data.ownerGithubId ?? null, ownerLogin: data.ownerLogin, status: data.status || 'pending', source: data.source || 'application', syncStatus: data.syncStatus || 'pending', wpId: data.wpId, createdAt: data.createdAt || now, updatedAt: now, ownerAssignedAt: data.ownerAssignedAt, ownerAssignedBy: data.ownerAssignedBy, syncError: data.syncError }
}
