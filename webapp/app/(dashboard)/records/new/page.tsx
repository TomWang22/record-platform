'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ApiError, apiFetch } from '@/lib/api-client'

type NewRecord = {
  artist: string
  name: string
  format: string
  catalogNumber?: string
  recordGrade?: string
  sleeveGrade?: string
  pricePaid?: number
  purchasedAt?: string
  notes?: string
}

const defaultRecord: NewRecord = {
  artist: '',
  name: '',
  format: 'LP',
  catalogNumber: '',
  recordGrade: '',
  sleeveGrade: '',
  pricePaid: undefined,
  purchasedAt: '',
  notes: '',
}

export default function NewRecordPage() {
  const router = useRouter()
  const [record, setRecord] = useState<NewRecord>(defaultRecord)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  async function createRecord() {
    if (!record.artist || !record.name || !record.format) {
      setMessage('Artist, name, and format are required')
      return
    }

    setSaving(true)
    setMessage('')
    try {
      const data = await apiFetch<{ id: string }>('/records', {
        method: 'POST',
        auth: true,
        data: {
          ...record,
          catalogNumber: record.catalogNumber || undefined,
          recordGrade: record.recordGrade || undefined,
          sleeveGrade: record.sleeveGrade || undefined,
          pricePaid: record.pricePaid || undefined,
          purchasedAt: record.purchasedAt ? `${record.purchasedAt}T00:00:00Z` : undefined,
          notes: record.notes || undefined,
        },
      })
      router.push(`/records/${data.id}`)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        router.replace('/login')
        return
      }
      setMessage(error instanceof Error ? error.message : 'Failed to create record')
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Add new record</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Create a new entry in your catalog.</p>
        </div>
        <Button variant="ghost" onClick={() => router.push('/records')}>
          Cancel
        </Button>
      </div>

      {message && (
        <div className="rounded-xl border border-rose-200/80 bg-rose-50 p-3 text-sm text-rose-600 dark:border-rose-900/50 dark:bg-rose-950/50 dark:text-rose-400">
          {message}
        </div>
      )}

      <Card title="Record information">
        <div className="grid gap-4 sm:grid-cols-2">
          <RequiredField
            label="Artist"
            value={record.artist}
            onChange={(value) => setRecord((prev) => ({ ...prev, artist: value }))}
          />
          <RequiredField
            label="Album/Release"
            value={record.name}
            onChange={(value) => setRecord((prev) => ({ ...prev, name: value }))}
          />
          <RequiredField
            label="Format"
            value={record.format}
            onChange={(value) => setRecord((prev) => ({ ...prev, format: value }))}
          />
          <Field
            label="Catalog Number"
            value={record.catalogNumber || ''}
            onChange={(value) => setRecord((prev) => ({ ...prev, catalogNumber: value }))}
          />
          <Field
            label="Record Grade"
            value={record.recordGrade || ''}
            onChange={(value) => setRecord((prev) => ({ ...prev, recordGrade: value }))}
          />
          <Field
            label="Sleeve Grade"
            value={record.sleeveGrade || ''}
            onChange={(value) => setRecord((prev) => ({ ...prev, sleeveGrade: value }))}
          />
          <NumberField
            label="Price Paid"
            value={record.pricePaid || 0}
            onChange={(value) => setRecord((prev) => ({ ...prev, pricePaid: value || undefined }))}
          />
          <Field
            label="Purchased At"
            type="date"
            value={record.purchasedAt || ''}
            onChange={(value) => setRecord((prev) => ({ ...prev, purchasedAt: value }))}
          />
        </div>
        <div className="mt-4">
          <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
            Notes
            <textarea
              value={record.notes || ''}
              onChange={(event) => setRecord((prev) => ({ ...prev, notes: event.target.value }))}
              rows={3}
              className="mt-1 w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
            />
          </label>
        </div>
      </Card>

      <div className="flex gap-3">
        <Button onClick={createRecord} disabled={saving || !record.artist || !record.name || !record.format}>
          {saving ? 'Creating…' : 'Create record'}
        </Button>
        <Button variant="ghost" onClick={() => router.push('/records')} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

type FieldProps = {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
}

function Field({ label, value, onChange, type = 'text' }: FieldProps) {
  return (
    <label className="text-sm font-medium text-slate-600 dark:text-slate-300">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
      />
    </label>
  )
}

function RequiredField({ label, value, onChange, type = 'text' }: FieldProps) {
  return (
    <label className="text-sm font-medium text-slate-600 dark:text-slate-300">
      {label} <span className="text-rose-600">*</span>
      <input
        type={type}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
      />
    </label>
  )
}

type NumberFieldProps = {
  label: string
  value: number
  onChange: (value: number) => void
}

function NumberField({ label, value, onChange }: NumberFieldProps) {
  return (
    <label className="text-sm font-medium text-slate-600 dark:text-slate-300">
      {label}
      <input
        type="number"
        step="0.01"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
      />
    </label>
  )
}











