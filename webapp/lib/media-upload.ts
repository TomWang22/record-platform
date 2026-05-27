export type UploadedMedia = {
  id: string
  url: string
  kind: 'image' | 'video'
  fileName?: string
}

/** Upload via media API when available; otherwise dev-safe local object URLs. */
export async function uploadMediaFiles(
  files: File[],
  opts?: { authToken?: string },
): Promise<UploadedMedia[]> {
  if (!files.length) return []

  const payload = new FormData()
  for (const file of files) {
    payload.append('files', file)
  }

  const headers: HeadersInit = {}
  if (opts?.authToken) {
    headers.Authorization = `Bearer ${opts.authToken}`
  }

  try {
    const res = await fetch('/api/media/upload', {
      method: 'POST',
      headers,
      body: payload,
    })
    if (res.ok) {
      const data = (await res.json()) as {
        assetIds?: string[]
        urls?: string[]
        items?: Array<{ id: string; url: string }>
      }
      if (Array.isArray(data.items) && data.items.length) {
        return data.items.map((item) => ({
          id: item.id,
          url: item.url,
          kind: 'image' as const,
        }))
      }
      const ids = data.assetIds ?? (data.urls ? data.urls.map((_, i) => `asset-${i}`) : [])
      const urls = data.urls ?? []
      if (ids.length) {
        return ids.map((id, i) => ({
          id,
          url: urls[i] ?? `/api/media/${id}`,
          kind: files[i]?.type.startsWith('video/') ? 'video' : 'image',
          fileName: files[i]?.name,
        }))
      }
    }
  } catch {
    // fall through to local preview URLs
  }

  return files.map((file, index) => ({
    id: `local-${Date.now()}-${index}`,
    url: URL.createObjectURL(file),
    kind: file.type.startsWith('video/') ? 'video' : 'image',
    fileName: file.name,
  }))
}
