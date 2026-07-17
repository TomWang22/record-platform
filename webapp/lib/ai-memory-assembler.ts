export type IntelligenceMemoryItem = {
  memory_id: string
  memory_class?: string
  owner_fixture: string
  scope: { thread_id?: string }
  fact_key: string
  content: { value: unknown }
  content_summary?: string
  source_turn_ids: string[]
  deletion_state: 'ACTIVE' | 'DELETED'
  source_label?: string
  durable_consent?: boolean
  expires_at?: string | null
  [key: string]: unknown
}

export type MemoryAssemblyInput = {
  principalId: string
  threadId: string
  memoryItems?: IntelligenceMemoryItem[]
}

export const MEMORY_ASSEMBLER_VERSION = 'phase34b-memory-v1'

export function assembleMemoryRequest(input: MemoryAssemblyInput) {
  const memory_items = (input.memoryItems || []).filter(
    (item) =>
      item.owner_fixture === input.principalId &&
      item.scope?.thread_id === input.threadId &&
      item.deletion_state === 'ACTIVE',
  )
  return {
    requesting_principal_fixture: input.principalId,
    principal_id: input.principalId,
    thread_id: input.threadId,
    operation: 'resolve',
    max_recall: 20,
    memory_items,
    allow_durable_write: false,
    durable_consent: false,
    isolation_notice: `Facts are isolated to user ${input.principalId} and thread ${input.threadId}; no cross-thread or cross-user recall.`,
    assembler_version: MEMORY_ASSEMBLER_VERSION,
  }
}

export function buildMemoryCorrection(input: {
  principalId: string
  threadId: string
  memoryId: string
  factKey: string
  value: string
}): IntelligenceMemoryItem {
  return {
    memory_id: input.memoryId,
    memory_class: 'session',
    owner_fixture: input.principalId,
    scope: { thread_id: input.threadId },
    fact_key: input.factKey,
    content: { value: input.value },
    content_summary: input.value,
    source_turn_ids: [],
    deletion_state: 'ACTIVE',
    source_label: 'user_correction',
    durable_consent: false,
    expires_at: null,
  }
}
