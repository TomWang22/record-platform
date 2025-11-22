'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ApiError, apiFetch } from '@/lib/api-client'

type RecordItem = {
  id: string
  artist: string
  name: string
  format: string
  catalogNumber?: string
}

export default function RecordsPage() {
  const router = useRouter()
  const [records, setRecords] = useState<RecordItem[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    void fetchRecords()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchRecords(nextQuery = query) {
    setLoading(true)
    setStatus('')
    try {
      const params = nextQuery ? `?${new URLSearchParams({ q: nextQuery })}` : ''
      const data = await apiFetch<RecordItem[]>(`/records${params}`, {
        auth: true,
      })
      setRecords(data)
    } catch (error) {
      handleApiError(error)
    } finally {
      setLoading(false)
    }
  }

  async function deleteRecord(id: string) {
    if (!confirm('Delete this record? This cannot be undone.')) return
    setDeletingId(id)
    try {
      await apiFetch(`/records/${id}`, { method: 'DELETE', auth: true })
      setRecords((prev) => prev.filter((r) => r.id !== id))
      setStatus('Record deleted')
    } catch (error) {
      handleApiError(error)
    } finally {
      setDeletingId(null)
    }
  }

  async function exportCsv() {
    setStatus('Exporting records to object storage…')
    try {
      const result = await apiFetch<{ bucket?: string; key?: string }>(`/records/export`, {
        method: 'POST',
        auth: true,
      })
      if (result?.bucket && result?.key) {
        setStatus(`Exported to s3://${result.bucket}/${result.key}`)
      } else {
        setStatus('Export completed')
      }
    } catch (error) {
      handleApiError(error)
    }
  }

  function handleApiError(error: unknown) {
    if (error instanceof ApiError && error.status === 401) {
      router.replace('/login')
      return
    }
    setStatus(error instanceof Error ? error.message : 'Something went wrong')
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Records</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Search your catalog and run exports backed by pgbench-tuned APIs.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild>
            <Link href="/records/new">Add record</Link>
          </Button>
          <Button variant="secondary" onClick={exportCsv} disabled={loading}>
            Export CSV → S3/R2
          </Button>
        </div>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <input
            placeholder="Search artist, album, catalog number…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void fetchRecords()
            }}
            className="flex-1 min-w-[220px] rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
          />
          <Button onClick={() => void fetchRecords()} disabled={loading}>
            {loading ? 'Loading…' : 'Search'}
          </Button>
          <Button variant="ghost" onClick={() => { setQuery(''); void fetchRecords('') }} disabled={loading || !query}>
            Clear
          </Button>
        </div>

        {status && <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{status}</p>}
      </Card>

      <Card title="Results">
        {loading && <p className="text-sm text-slate-500">Loading records…</p>}
        {!loading && records.length === 0 && <p className="text-sm text-slate-400">No records found for this query.</p>}
        {!loading && records.length > 0 && (
          <ul className="divide-y divide-slate-100 dark:divide-white/5">
            {records.map((record) => (
              <li key={record.id} className="group flex items-center justify-between gap-4 py-3">
                <Link href={`/records/${record.id}`} className="flex-1 hover:opacity-80">
                  <p className="font-medium text-slate-900 dark:text-white">
                    {record.artist} — {record.name}
                  </p>
                  <p className="text-sm text-slate-500">
                    {record.format} {record.catalogNumber ? `· ${record.catalogNumber}` : ''}
                  </p>
                </Link>
                <div className="flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/records/${record.id}`}>View</Link>
                  </Button>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/market?record=${record.id}`}>Sell / List</Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void deleteRecord(record.id)}
                    disabled={deletingId === record.id}
                    className="text-rose-600 hover:text-rose-700"
                  >
                    {deletingId === record.id ? 'Deleting…' : 'Delete'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

