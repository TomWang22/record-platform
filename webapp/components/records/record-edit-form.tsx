'use client'

import { Card } from '@/components/ui/card'
import type { CollectionRecord } from '@/lib/records-types'

export type RecordFormValues = Omit<CollectionRecord, 'id' | 'userId' | 'createdAt' | 'updatedAt' | 'mediaPieces'> & {
  purchasedAtDate?: string
  receivedAtDate?: string
  releaseDateDate?: string
}

export function emptyRecordForm(): RecordFormValues {
  return {
    artist: '',
    name: '',
    format: 'LP',
    catalogNumber: '',
    recordGrade: '',
    sleeveGrade: '',
    label: '',
    labelCode: '',
    releaseYear: undefined,
    releaseDateDate: '',
    pressingYear: undefined,
    hasInsert: false,
    hasBooklet: false,
    hasObiStrip: false,
    hasFactorySleeve: false,
    isPromo: false,
    notes: '',
    purchasedAtDate: '',
    receivedAtDate: '',
    purchaseType: 'fixed_price',
    purchaseSource: '',
    sellerName: '',
    orderReference: '',
    purchasePriceCents: undefined,
    shippingPaidCents: undefined,
    taxesFeesPaidCents: undefined,
    purchaseCurrency: 'USD',
    purchaseNotes: '',
    pricePaid: undefined,
  }
}

export function recordToFormValues(record: CollectionRecord): RecordFormValues {
  return {
    artist: record.artist,
    name: record.name,
    format: record.format,
    catalogNumber: record.catalogNumber ?? '',
    recordGrade: record.recordGrade ?? '',
    sleeveGrade: record.sleeveGrade ?? '',
    label: record.label ?? '',
    labelCode: record.labelCode ?? '',
    releaseYear: record.releaseYear ?? undefined,
    releaseDateDate: record.releaseDate?.split('T')[0] ?? '',
    pressingYear: record.pressingYear ?? undefined,
    hasInsert: record.hasInsert ?? false,
    hasBooklet: record.hasBooklet ?? false,
    hasObiStrip: record.hasObiStrip ?? false,
    hasFactorySleeve: record.hasFactorySleeve ?? false,
    isPromo: record.isPromo ?? false,
    notes: record.notes ?? '',
    purchasedAtDate: record.purchasedAt?.split('T')[0] ?? '',
    receivedAtDate: record.receivedAt?.split('T')[0] ?? '',
    purchaseType: record.purchaseType ?? 'fixed_price',
    purchaseSource: record.purchaseSource ?? '',
    sellerName: record.sellerName ?? '',
    orderReference: record.orderReference ?? '',
    purchasePriceCents: record.purchasePriceCents ?? undefined,
    shippingPaidCents: record.shippingPaidCents ?? undefined,
    taxesFeesPaidCents: record.taxesFeesPaidCents ?? undefined,
    purchaseCurrency: record.purchaseCurrency ?? 'USD',
    purchaseNotes: record.purchaseNotes ?? '',
    pricePaid: record.pricePaid ?? undefined,
  }
}

export function formValuesToApiPayload(values: RecordFormValues): Record<string, unknown> {
  const purchasedAt = values.purchasedAtDate
    ? `${values.purchasedAtDate}T00:00:00Z`
    : undefined
  const receivedAt = values.receivedAtDate
    ? `${values.receivedAtDate}T00:00:00Z`
    : undefined

  return {
    artist: values.artist,
    name: values.name,
    format: values.format,
    catalogNumber: values.catalogNumber || undefined,
    recordGrade: values.recordGrade || undefined,
    sleeveGrade: values.sleeveGrade || undefined,
    label: values.label || undefined,
    labelCode: values.labelCode || undefined,
    releaseYear: values.releaseYear || undefined,
    releaseDate: values.releaseDateDate || undefined,
    pressingYear: values.pressingYear || undefined,
    hasInsert: values.hasInsert,
    hasBooklet: values.hasBooklet,
    hasObiStrip: values.hasObiStrip,
    hasFactorySleeve: values.hasFactorySleeve,
    isPromo: values.isPromo,
    notes: values.notes || undefined,
    purchasedAt,
    receivedAt,
    purchaseType: values.purchaseType || undefined,
    purchaseSource: values.purchaseSource || undefined,
    sellerName: values.sellerName || undefined,
    orderReference: values.orderReference || undefined,
    purchasePriceCents:
      values.purchasePriceCents != null && values.purchasePriceCents >= 0
        ? Math.floor(values.purchasePriceCents)
        : undefined,
    shippingPaidCents:
      values.shippingPaidCents != null && values.shippingPaidCents >= 0
        ? Math.floor(values.shippingPaidCents)
        : undefined,
    taxesFeesPaidCents:
      values.taxesFeesPaidCents != null && values.taxesFeesPaidCents >= 0
        ? Math.floor(values.taxesFeesPaidCents)
        : undefined,
    purchaseCurrency: (values.purchaseCurrency || 'USD').toUpperCase(),
    purchaseNotes: values.purchaseNotes || undefined,
    pricePaid: values.pricePaid || undefined,
  }
}

export function validateRecordForm(values: RecordFormValues): string | null {
  if (!values.artist?.trim() || !values.name?.trim() || !values.format?.trim()) {
    return 'Artist, title, and format are required'
  }
  if (
    values.receivedAtDate &&
    values.purchasedAtDate &&
    values.receivedAtDate < values.purchasedAtDate
  ) {
    return 'Received date cannot be before purchased date'
  }
  const moneyFields = [
    values.purchasePriceCents,
    values.shippingPaidCents,
    values.taxesFeesPaidCents,
  ]
  if (moneyFields.some((n) => n != null && n < 0)) {
    return 'Money fields must be zero or greater'
  }
  if (!values.purchaseCurrency?.trim()) {
    return 'Currency is required when purchase details are set'
  }
  return null
}

type Props = {
  values: RecordFormValues
  onChange: (values: RecordFormValues) => void
  disabled?: boolean
}

export function RecordEditForm({ values, onChange, disabled }: Props) {
  const set = (patch: Partial<RecordFormValues>) =>
    onChange({ ...values, ...patch })

  return (
    <>
      <Card title="Catalog">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Artist *" value={values.artist} disabled={disabled} onChange={(v) => set({ artist: v })} />
          <Field label="Album / release *" value={values.name} disabled={disabled} onChange={(v) => set({ name: v })} />
          <Field label="Format *" value={values.format} disabled={disabled} onChange={(v) => set({ format: v })} />
          <Field label="Catalog #" value={values.catalogNumber ?? ''} disabled={disabled} onChange={(v) => set({ catalogNumber: v })} />
          <Field label="Label" value={values.label ?? ''} disabled={disabled} onChange={(v) => set({ label: v })} />
          <Field label="Label code" value={values.labelCode ?? ''} disabled={disabled} onChange={(v) => set({ labelCode: v })} />
          <Field label="Record grade" value={values.recordGrade ?? ''} disabled={disabled} onChange={(v) => set({ recordGrade: v })} />
          <Field label="Sleeve grade" value={values.sleeveGrade ?? ''} disabled={disabled} onChange={(v) => set({ sleeveGrade: v })} />
          <NumberField label="Release year" value={values.releaseYear ?? 0} disabled={disabled} onChange={(n) => set({ releaseYear: n || undefined })} integer />
          <Field label="Release date" type="date" value={values.releaseDateDate ?? ''} disabled={disabled} onChange={(v) => set({ releaseDateDate: v })} />
          <NumberField label="Pressing year" value={values.pressingYear ?? 0} disabled={disabled} onChange={(n) => set({ pressingYear: n || undefined })} integer />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Checkbox label="Insert" checked={!!values.hasInsert} disabled={disabled} onChange={(c) => set({ hasInsert: c })} />
          <Checkbox label="Booklet" checked={!!values.hasBooklet} disabled={disabled} onChange={(c) => set({ hasBooklet: c })} />
          <Checkbox label="OBI" checked={!!values.hasObiStrip} disabled={disabled} onChange={(c) => set({ hasObiStrip: c })} />
          <Checkbox label="Factory sleeve" checked={!!values.hasFactorySleeve} disabled={disabled} onChange={(c) => set({ hasFactorySleeve: c })} />
          <Checkbox label="Promo" checked={!!values.isPromo} disabled={disabled} onChange={(c) => set({ isPromo: c })} />
        </div>
        <div className="mt-4">
          <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
            Collection notes
            <textarea
              value={values.notes ?? ''}
              disabled={disabled}
              onChange={(e) => set({ notes: e.target.value })}
              rows={3}
              className="mt-1 w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-white"
            />
          </label>
        </div>
      </Card>

      <Card title="Purchase details">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-600 dark:text-slate-300">
            Purchase type
            <select
              value={values.purchaseType ?? 'fixed_price'}
              disabled={disabled}
              onChange={(e) => set({ purchaseType: e.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-white"
            >
              <option value="fixed_price">Fixed price</option>
              <option value="negotiated_obo">OBO / negotiated</option>
              <option value="auction_win">Auction win</option>
              <option value="trade">Trade</option>
              <option value="gift">Gift</option>
              <option value="retail">Retail</option>
              <option value="other">Other</option>
            </select>
          </label>
          <Field label="Purchased on" type="date" value={values.purchasedAtDate ?? ''} disabled={disabled} onChange={(v) => set({ purchasedAtDate: v })} />
          <Field label="Received on" type="date" value={values.receivedAtDate ?? ''} disabled={disabled} onChange={(v) => set({ receivedAtDate: v })} />
          <Field label="Source" value={values.purchaseSource ?? ''} disabled={disabled} onChange={(v) => set({ purchaseSource: v })} />
          <Field label="Seller" value={values.sellerName ?? ''} disabled={disabled} onChange={(v) => set({ sellerName: v })} />
          <Field label="Order / reference" value={values.orderReference ?? ''} disabled={disabled} onChange={(v) => set({ orderReference: v })} />
          <NumberField label="Item price (¢)" value={values.purchasePriceCents ?? 0} disabled={disabled} onChange={(n) => set({ purchasePriceCents: n || undefined })} />
          <NumberField label="Shipping (¢)" value={values.shippingPaidCents ?? 0} disabled={disabled} onChange={(n) => set({ shippingPaidCents: n || undefined })} />
          <NumberField label="Taxes/fees (¢)" value={values.taxesFeesPaidCents ?? 0} disabled={disabled} onChange={(n) => set({ taxesFeesPaidCents: n || undefined })} />
          <Field label="Currency *" value={values.purchaseCurrency ?? 'USD'} disabled={disabled} onChange={(v) => set({ purchaseCurrency: v.toUpperCase() })} />
        </div>
        <div className="mt-4">
          <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
            Purchase notes
            <textarea
              value={values.purchaseNotes ?? ''}
              disabled={disabled}
              onChange={(e) => set({ purchaseNotes: e.target.value })}
              rows={3}
              className="mt-1 w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-white"
            />
          </label>
        </div>
      </Card>
    </>
  )
}

function Field({
  label,
  value,
  onChange,
  disabled,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  type?: string
}) {
  return (
    <label className="text-sm font-medium text-slate-600 dark:text-slate-300">
      {label}
      <input
        type={type}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-white disabled:opacity-60"
      />
    </label>
  )
}

function NumberField({
  label,
  value,
  onChange,
  disabled,
  integer,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  disabled?: boolean
  integer?: boolean
}) {
  return (
    <label className="text-sm font-medium text-slate-600 dark:text-slate-300">
      {label}
      <input
        type="number"
        min={0}
        step={integer ? 1 : 1}
        value={value || ''}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-white disabled:opacity-60"
      />
    </label>
  )
}

function Checkbox({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string
  checked: boolean
  onChange: (c: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded" />
      {label}
    </label>
  )
}
