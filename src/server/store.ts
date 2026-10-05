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
  /** 按 id 读取单条记录，避免为一次编辑扫描整张表。 */
  get(id: string): Promise<LinkRecord | null>
  put(link: LinkRecord): Promise<void>
  delete(id: string): Promise<void>
  /** 可选：是否还有旧版单 blob 数据待迁移。 */
  legacyStatus?(): Promise<{ pending: boolean }>
  /** 可选：把旧版单 blob 数据迁移为新格式，升级后手动执行一次。 */
  migrateLegacy?(): Promise<MigrationResult>
}

export type MigrationResult = {
  imported: number
  skipped: number
  alreadyMigrated: boolean
  completed: boolean
}

export function makeLink(data: Partial<LinkRecord> & Pick<LinkRecord, 'name' | 'url'>): LinkRecord {
  const now = Date.now()
  return { id: data.id || crypto.randomUUID(), name: data.name, url: data.url, description: data.description || '', avatar: data.avatar || '', ownerGithubId: data.ownerGithubId ?? null, ownerLogin: data.ownerLogin, status: data.status || 'pending', source: data.source || 'application', syncStatus: data.syncStatus || 'pending', wpId: data.wpId, createdAt: data.createdAt || now, updatedAt: now, ownerAssignedAt: data.ownerAssignedAt, ownerAssignedBy: data.ownerAssignedBy, syncError: data.syncError }
}