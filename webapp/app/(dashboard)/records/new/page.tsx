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
  label?: string
  labelCode?: string
  releaseYear?: number
  releaseDate?: string
  pressingYear?: number
  hasInsert?: boolean
  hasBooklet?: boolean
  hasObiStrip?: boolean
  hasFactorySleeve?: boolean
  isPromo?: boolean
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
  label: '',
  labelCode: '',
  releaseYear: undefined,
  releaseDate: '',
  pressingYear: undefined,
  hasInsert: false,
  hasBooklet: false,
  hasObiStrip: false,
  hasFactorySleeve: false,
  isPromo: false,
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
          label: record.label || undefined,
          labelCode: record.labelCode || undefined,
          releaseYear: record.releaseYear || undefined,
          releaseDate: record.releaseDate || undefined,
          pressingYear: record.pressingYear || undefined,
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
          <Field
            label="Label"
            value={record.label || ''}
            onChange={(value) => setRecord((prev) => ({ ...prev, label: value }))}
          />
          <Field
            label="Label Code"
            value={record.labelCode || ''}
            onChange={(value) => setRecord((prev) => ({ ...prev, labelCode: value }))}
          />
          <NumberField
            label="Release Year"
            value={record.releaseYear || 0}
            onChange={(value) => setRecord((prev) => ({ ...prev, releaseYear: value || undefined }))}
          />
          <Field
            label="Release Date"
            type="date"
            value={record.releaseDate || ''}
            onChange={(value) => setRecord((prev) => ({ ...prev, releaseDate: value }))}
          />
          <NumberField
            label="Pressing Year"
            value={record.pressingYear || 0}
            onChange={(value) => setRecord((prev) => ({ ...prev, pressingYear: value || undefined }))}
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
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <CheckboxField
            label="Has Insert"
            checked={record.hasInsert || false}
            onChange={(checked) => setRecord((prev) => ({ ...prev, hasInsert: checked }))}
          />
          <CheckboxField
            label="Has Booklet"
            checked={record.hasBooklet || false}
            onChange={(checked) => setRecord((prev) => ({ ...prev, hasBooklet: checked }))}
          />
          <CheckboxField
            label="Has Obi Strip"
            checked={record.hasObiStrip || false}
            onChange={(checked) => setRecord((prev) => ({ ...prev, hasObiStrip: checked }))}
          />
          <CheckboxField
            label="Has Factory Sleeve"
            checked={record.hasFactorySleeve || false}
            onChange={(checked) => setRecord((prev) => ({ ...prev, hasFactorySleeve: checked }))}
          />
          <CheckboxField
            label="Is Promo"
            checked={record.isPromo || false}
            onChange={(checked) => setRecord((prev) => ({ ...prev, isPromo: checked }))}
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
        step={label.includes('Year') ? '1' : '0.01'}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
      />
    </label>
  )
}

type CheckboxFieldProps = {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}

function CheckboxField({ label, checked, onChange }: CheckboxFieldProps) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand dark:border-slate-600"
      />
      {label}
    </label>
  )
}











