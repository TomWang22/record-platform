'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ApiError, apiFetch } from '@/lib/api-client'

type Settings = {
  country_code: string
  currency: string
  fee_rate: number
  duty_rate: number
}

const defaults: Settings = {
  country_code: 'US',
  currency: 'USD',
  fee_rate: 0,
  duty_rate: 0,
}

export default function SettingsPage() {
  const router = useRouter()
  const [settings, setSettings] = useState<Settings>(defaults)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    void loadSettings()
  }, [])

  async function loadSettings() {
    setLoading(true)
    try {
      const data = await apiFetch<Settings>('/listings/settings', { auth: true })
      setSettings(data)
    } catch (error) {
      handleError(error)
    } finally {
      setLoading(false)
    }
  }

  async function saveSettings() {
    setLoading(true)
    setMessage('')
    try {
      await apiFetch('/listings/settings', {
        method: 'PUT',
        auth: true,
        data: settings,
      })
      setMessage('Preferences saved')
    } catch (error) {
      handleError(error)
    } finally {
      setLoading(false)
    }
  }

  function handleError(error: unknown) {
    if (error instanceof ApiError && error.status === 401) {
      router.replace('/login')
      return
    }
    setMessage(error instanceof Error ? error.message : 'Unable to process request')
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Settings</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Control listing defaults, currency, and fees per tenant.</p>
      </header>

      <Card title="Marketplace defaults">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Country code"
            value={settings.country_code}
            maxLength={2}
            onChange={(value) => setSettings((prev) => ({ ...prev, country_code: value.toUpperCase() }))}
          />
          <Field
            label="Currency"
            value={settings.currency}
            maxLength={3}
            onChange={(value) => setSettings((prev) => ({ ...prev, currency: value.toUpperCase() }))}
          />
          <NumberField
            label="Marketplace fee %"
            value={settings.fee_rate}
            onChange={(value) => setSettings((prev) => ({ ...prev, fee_rate: value }))}
          />
          <NumberField
            label="Customs / VAT %"
            value={settings.duty_rate}
            onChange={(value) => setSettings((prev) => ({ ...prev, duty_rate: value }))}
          />
        </div>
        <div className="mt-6 flex items-center gap-3">
          <Button onClick={saveSettings} disabled={loading}>
            {loading ? 'Saving…' : 'Save changes'}
          </Button>
          <Button variant="ghost" disabled={loading} onClick={() => void loadSettings()}>
            Reset
          </Button>
          {message && <p className="text-sm text-slate-500 dark:text-slate-400">{message}</p>}
        </div>
      </Card>
    </div>
  )
}

type FieldProps = {
  label: string
  value: string
  onChange: (value: string) => void
  maxLength?: number
}

function Field({ label, value, onChange, maxLength }: FieldProps) {
  return (
    <label className="text-sm font-medium text-slate-600 dark:text-slate-300">
      {label}
      <input
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-base text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
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
        value={value}
        step="0.1"
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-base text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
      />
    </label>
  )
}












