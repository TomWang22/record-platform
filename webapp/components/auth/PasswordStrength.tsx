'use client'

import { useMemo } from 'react'
import { cn } from '@/lib/utils'

export type PasswordStrength = 'weak' | 'medium' | 'strong' | 'very-strong'

export interface PasswordRequirements {
  length: boolean
  lowercase: boolean
  uppercase: boolean
  number: boolean
  special: boolean
}

export interface PasswordStrengthResult {
  strength: PasswordStrength
  score: number // 0-100
  requirements: PasswordRequirements
  label: string
  color: string
}

export function calculatePasswordStrength(password: string): PasswordStrengthResult {
  if (!password) {
    return {
      strength: 'weak',
      score: 0,
      requirements: {
        length: false,
        lowercase: false,
        uppercase: false,
        number: false,
        special: false,
      },
      label: 'Enter a password',
      color: 'slate',
    }
  }

  const requirements: PasswordRequirements = {
    length: password.length >= 8,
    lowercase: /[a-z]/.test(password),
    uppercase: /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^a-zA-Z0-9]/.test(password),
  }

  const metCount = Object.values(requirements).filter(Boolean).length
  const totalCount = Object.keys(requirements).length

  // Calculate base score from requirements
  let score = (metCount / totalCount) * 60

  // Bonus points for length
  if (password.length >= 12) score += 20
  else if (password.length >= 10) score += 10

  // Bonus points for complexity
  if (metCount >= 4) score += 20
  else if (metCount >= 3) score += 10

  score = Math.min(100, Math.max(0, score))

  let strength: PasswordStrength
  let label: string
  let color: string

  if (score < 40) {
    strength = 'weak'
    label = 'Weak'
    color = 'rose'
  } else if (score < 60) {
    strength = 'medium'
    label = 'Medium'
    color = 'amber'
  } else if (score < 80) {
    strength = 'strong'
    label = 'Strong'
    color = 'emerald'
  } else {
    strength = 'very-strong'
    label = 'Very Strong'
    color = 'emerald'
  }

  return {
    strength,
    score,
    requirements,
    label,
    color,
  }
}

interface PasswordStrengthIndicatorProps {
  password: string
  showRequirements?: boolean
  className?: string
}

export function PasswordStrengthIndicator({
  password,
  showRequirements = true,
  className,
}: PasswordStrengthIndicatorProps) {
  const result = useMemo(() => calculatePasswordStrength(password), [password])

  if (!password) return null

  const colorClasses = {
    rose: 'bg-rose-500',
    amber: 'bg-amber-500',
    emerald: 'bg-emerald-500',
    slate: 'bg-slate-300',
  }

  const textColorClasses = {
    rose: 'text-rose-600 dark:text-rose-400',
    amber: 'text-amber-600 dark:text-amber-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    slate: 'text-slate-600 dark:text-slate-400',
  }

  return (
    <div className={cn('space-y-2', className)}>
      {/* Progress Bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className={cn('font-medium', textColorClasses[result.color as keyof typeof textColorClasses])}>
            Password Strength: {result.label}
          </span>
          <span className="text-slate-500 dark:text-slate-400">{result.score}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          <div
            className={cn(
              'h-full transition-all duration-300 ease-out',
              colorClasses[result.color as keyof typeof colorClasses]
            )}
            style={{ width: `${result.score}%` }}
          />
        </div>
      </div>

      {/* Requirements Checklist */}
      {showRequirements && (
        <div className="space-y-1 text-xs">
          <p className="text-slate-600 dark:text-slate-400">Requirements:</p>
          <ul className="space-y-0.5">
            <RequirementItem met={result.requirements.length} label="At least 8 characters" />
            <RequirementItem met={result.requirements.lowercase} label="One lowercase letter" />
            <RequirementItem met={result.requirements.uppercase} label="One uppercase letter" />
            <RequirementItem met={result.requirements.number} label="One number" />
            <RequirementItem met={result.requirements.special} label="One special character" />
          </ul>
        </div>
      )}
    </div>
  )
}

function RequirementItem({ met, label }: { met: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span
        className={cn(
          'flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold',
          met
            ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'
            : 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-600'
        )}
      >
        {met ? '✓' : '○'}
      </span>
      <span
        className={cn(
          met
            ? 'text-emerald-700 dark:text-emerald-300'
            : 'text-slate-500 dark:text-slate-400'
        )}
      >
        {label}
      </span>
    </li>
  )
}

