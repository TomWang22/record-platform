'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { uploadMediaFiles, type UploadedMedia } from '@/lib/media-upload'
import { getClientSessionToken } from '@/lib/session'

export type RecordMediaDraft = UploadedMedia & {
  isPrimary?: boolean
}

type Props = {
  value: RecordMediaDraft[]
  onChange: (items: RecordMediaDraft[]) => void
  disabled?: boolean
}

export function RecordMediaUpload({ value, onChange, disabled }: Props) {
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState('')

  async function onFiles(files: FileList | null) {
    if (!files?.length || disabled) return
    setUploading(true)
    setMessage('')
    try {
      const token = getClientSessionToken()
      const uploaded = await uploadMediaFiles(Array.from(files), {
        authToken: token ?? undefined,
      })
      const next = [
        ...value,
        ...uploaded.map((u, i) => ({
          ...u,
          isPrimary: value.length === 0 && i === 0,
        })),
      ]
      onChange(next)
      setMessage(`Added ${uploaded.length} file(s)`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  function setPrimary(id: string) {
    onChange(value.map((m) => ({ ...m, isPrimary: m.id === id })))
  }

  function remove(id: string) {
    const next = value.filter((m) => m.id !== id)
    if (next.length && !next.some((m) => m.isPrimary)) {
      next[0]!.isPrimary = true
    }
    onChange(next)
  }

  function move(id: string, dir: -1 | 1) {
    const idx = value.findIndex((m) => m.id === id)
    if (idx < 0) return
    const target = idx + dir
    if (target < 0 || target >= value.length) return
    const copy = [...value]
    const [item] = copy.splice(idx, 1)
    copy.splice(target, 0, item!)
    onChange(copy)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <label className="inline-flex cursor-pointer">
          <input
            type="file"
            accept="image/*,video/*"
            multiple
            className="sr-only"
            disabled={disabled || uploading}
            onChange={(e) => void onFiles(e.target.files)}
          />
          <span className="inline-flex items-center rounded-xl border border-dashed border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:border-brand dark:border-white/20 dark:text-slate-200">
            {uploading ? 'Uploading…' : 'Add images / video'}
          </span>
        </label>
      </div>
      {message && <p className="text-xs text-slate-500">{message}</p>}

      {value.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {value.map((m) => (
            <li
              key={m.id}
              className={`overflow-hidden rounded-xl border p-2 ${
                m.isPrimary ? 'border-brand ring-1 ring-brand/30' : 'border-slate-200 dark:border-white/10'
              }`}
            >
              {m.kind === 'video' ? (
                <video src={m.url} className="h-32 w-full rounded-lg bg-black object-cover" controls />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt="" className="h-32 w-full rounded-lg object-cover" />
              )}
              <p className="mt-2 truncate text-xs text-slate-500">{m.fileName ?? m.id}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                <Button type="button" size="sm" variant={m.isPrimary ? 'secondary' : 'ghost'} onClick={() => setPrimary(m.id)}>
                  {m.isPrimary ? 'Primary' : 'Set primary'}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => move(m.id, -1)}>
                  ↑
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => move(m.id, 1)}>
                  ↓
                </Button>
                <Button type="button" size="sm" variant="ghost" className="text-rose-600" onClick={() => remove(m.id)}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function recordMediaToApiPieces(media: RecordMediaDraft[]) {
  return media.map((m, index) => ({
    kind: m.kind === 'video' ? 'VIDEO' : 'LP',
    index,
    urlOrPath: m.url,
    __formatHint: 'LP',
  }))
}
