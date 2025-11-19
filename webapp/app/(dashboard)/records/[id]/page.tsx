'use client'

import { useRouter, useParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ApiError, apiFetch } from '@/lib/api-client'

type RecordDetail = {
  id: string
  artist: string
  name: string
  format: string
  catalogNumber?: string
  recordGrade?: string
  sleeveGrade?: string
  pricePaid?: number
  purchasedAt?: string
  notes?: string
  isPromo?: boolean
  hasInsert?: boolean
  hasBooklet?: boolean
  hasObiStrip?: boolean
  hasFactorySleeve?: boolean
}

export default function RecordDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const [record, setRecord] = useState<RecordDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [isEditing, setIsEditing] = useState(false)

  useEffect(() => {
    if (id) void loadRecord()
  }, [id])

  async function loadRecord() {
    setLoading(true)
    setMessage('')
    try {
      const data = await apiFetch<RecordDetail>(`/records/${id}`, { auth: true })
      setRecord(data)
    } catch (error) {
      handleError(error)
    } finally {
      setLoading(false)
    }
  }

  async function saveRecord() {
    if (!record) return
    setSaving(true)
    setMessage('')
    try {
      await apiFetch(`/records/${id}`, {
        method: 'PUT',
        auth: true,
        data: record,
      })
      setMessage('Record updated')
      setIsEditing(false)
    } catch (error) {
      handleError(error)
    } finally {
      setSaving(false)
    }
  }

  async function deleteRecord() {
    if (!confirm('Delete this record? This cannot be undone.')) return
    setSaving(true)
    try {
      await apiFetch(`/records/${id}`, { method: 'DELETE', auth: true })
      router.push('/records')
    } catch (error) {
      handleError(error)
      setSaving(false)
    }
  }

  function handleError(error: unknown) {
    if (error instanceof ApiError && error.status === 401) {
      router.replace('/login')
      return
    }
    setMessage(error instanceof Error ? error.message : 'Something went wrong')
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <p className="text-sm text-slate-500">Loading record…</p>
      </div>
    )
  }

  if (!record) {
    return (
      <div className="space-y-6">
        <p className="text-sm text-rose-600">Record not found</p>
        <Button variant="ghost" onClick={() => router.push('/records')}>
          Back to records
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
            {record.artist} — {record.name}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{record.format}</p>
        </div>
        <div className="flex gap-2">
          {isEditing ? (
            <>
              <Button onClick={saveRecord} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
              <Button variant="ghost" onClick={() => { setIsEditing(false); void loadRecord() }} disabled={saving}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setIsEditing(true)}>
                Edit
              </Button>
              <Button variant="ghost" onClick={() => router.push('/records')}>
                Back
              </Button>
            </>
          )}
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-slate-200/80 bg-slate-50 p-3 text-sm text-slate-600 dark:border-white/10 dark:bg-slate-900 dark:text-slate-300">
          {message}
        </div>
      )}

      <Card title="Details">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Artist"
            value={record.artist}
            disabled={!isEditing}
            onChange={(value) => setRecord((prev) => prev && { ...prev, artist: value })}
          />
          <Field
            label="Album/Release"
            value={record.name}
            disabled={!isEditing}
            onChange={(value) => setRecord((prev) => prev && { ...prev, name: value })}
          />
          <Field
            label="Format"
            value={record.format}
            disabled={!isEditing}
            onChange={(value) => setRecord((prev) => prev && { ...prev, format: value })}
          />
          <Field
            label="Catalog Number"
            value={record.catalogNumber || ''}
            disabled={!isEditing}
            onChange={(value) => setRecord((prev) => prev && { ...prev, catalogNumber: value || undefined })}
          />
          <Field
            label="Record Grade"
            value={record.recordGrade || ''}
            disabled={!isEditing}
            onChange={(value) => setRecord((prev) => prev && { ...prev, recordGrade: value || undefined })}
          />
          <Field
            label="Sleeve Grade"
            value={record.sleeveGrade || ''}
            disabled={!isEditing}
            onChange={(value) => setRecord((prev) => prev && { ...prev, sleeveGrade: value || undefined })}
          />
          <NumberField
            label="Price Paid"
            value={record.pricePaid || 0}
            disabled={!isEditing}
            onChange={(value) => setRecord((prev) => prev && { ...prev, pricePaid: value || undefined })}
          />
          <Field
            label="Purchased At"
            type="date"
            value={record.purchasedAt ? record.purchasedAt.split('T')[0] : ''}
            disabled={!isEditing}
            onChange={(value) =>
              setRecord((prev) => prev && { ...prev, purchasedAt: value ? `${value}T00:00:00Z` : undefined })
            }
          />
        </div>
        <div className="mt-4">
          <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
            Notes
            <textarea
              value={record.notes || ''}
              disabled={!isEditing}
              onChange={(event) => setRecord((prev) => prev && { ...prev, notes: event.target.value || undefined })}
              rows={3}
              className="mt-1 w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none disabled:bg-slate-50 disabled:text-slate-500 dark:border-white/10 dark:bg-slate-950 dark:text-white disabled:dark:bg-slate-900"
            />
          </label>
        </div>
      </Card>

      {!isEditing && (
        <Card title="Actions">
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setIsEditing(true)}>
              Edit record
            </Button>
            <Button variant="ghost" onClick={deleteRecord} disabled={saving} className="text-rose-600 hover:text-rose-700">
              Delete record
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}

type FieldProps = {
  label: string
  value: string
  disabled?: boolean
  onChange: (value: string) => void
  type?: string
}

function Field({ label, value, disabled, onChange, type = 'text' }: FieldProps) {
  return (
    <label className="text-sm font-medium text-slate-600 dark:text-slate-300">
      {label}
      <input
        type={type}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none disabled:bg-slate-50 disabled:text-slate-500 dark:border-white/10 dark:bg-slate-950 dark:text-white disabled:dark:bg-slate-900"
      />
    </label>
  )
}

type NumberFieldProps = {
  label: string
  value: number
  disabled?: boolean
  onChange: (value: number) => void
}

function NumberField({ label, value, disabled, onChange }: NumberFieldProps) {
  return (
    <label className="text-sm font-medium text-slate-600 dark:text-slate-300">
      {label}
      <input
        type="number"
        step="0.01"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none disabled:bg-slate-50 disabled:text-slate-500 dark:border-white/10 dark:bg-slate-950 dark:text-white disabled:dark:bg-slate-900"
      />
    </label>
  )
}











