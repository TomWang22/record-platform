import fs from 'node:fs'
import path from 'node:path'

export type ProtocolResourceEntry = {
  name: string
  initiatorType: string
  nextHopProtocol: string
  duration_ms: number
  transferSize: number
  encodedBodySize: number
  responseStatus?: number
}

export type ProtocolPipelineSession = {
  ticket: 'T20.13U'
  baseline_sha: string
  run_timestamp: string
  base_url: string
  browser: string
  document_protocol: ProtocolResourceEntry | null
  rag_query_protocol: ProtocolResourceEntry | null
  rag_http_status: number
  rag_ui_ms: number
  rag_api_ms: number
  console_errors: string[]
  failed_requests: Array<{ url: string; status: number; method: string }>
  retrieval_mode: string
  model_used: string
  leakage: string
}

export function protocolArtifactDir(timestamp: string): string {
  const repoRoot = path.resolve(process.cwd(), '..')
  return path.join(repoRoot, 'bench_logs', 'ai-platform', 'ui-protocol-pipeline', timestamp)
}

export function writeProtocolArtifacts(session: ProtocolPipelineSession, timestamp: string): {
  jsonPath: string
  mdPath: string
} {
  const dir = protocolArtifactDir(timestamp)
  fs.mkdirSync(dir, { recursive: true })
  const jsonPath = path.join(dir, `${timestamp}.json`)
  const mdPath = path.join(dir, `${timestamp}.md`)
  fs.writeFileSync(jsonPath, JSON.stringify(session, null, 2))
  const lines = [
    '# Protocol pipeline browser capture (T20.13U)',
    '',
    `Timestamp: ${timestamp}`,
    `Baseline: ${session.baseline_sha}`,
    '',
    '## Resource timing',
    '',
    `Document: ${session.document_protocol?.nextHopProtocol ?? 'not_exposed'}`,
    `RAG query: ${session.rag_query_protocol?.nextHopProtocol ?? 'not_exposed'}`,
    `RAG HTTP: ${session.rag_http_status}`,
    `retrieval_mode: ${session.retrieval_mode}`,
    `model_used: ${session.model_used}`,
    `leakage: ${session.leakage}`,
    '',
  ]
  fs.writeFileSync(mdPath, lines.join('\n'))
  return { jsonPath, mdPath }
}

export function pickResource(
  entries: ProtocolResourceEntry[],
  matcher: (e: ProtocolResourceEntry) => boolean,
): ProtocolResourceEntry | null {
  const hit = entries.filter(matcher).sort((a, b) => b.duration_ms - a.duration_ms)[0]
  return hit ?? null
}
