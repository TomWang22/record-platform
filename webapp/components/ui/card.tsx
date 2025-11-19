import { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type CardProps = {
  title?: string
  description?: string
  children: ReactNode
  className?: string
  actions?: ReactNode
}

export function Card({ title, description, children, className, actions }: CardProps) {
  return (
    <section className={cn('rounded-2xl border border-slate-200/80 bg-white p-6 shadow-card dark:border-white/10 dark:bg-slate-900', className)}>
      {(title || description || actions) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h3 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h3>}
            {description && <p className="text-sm text-slate-500 dark:text-slate-400">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div>{children}</div>
    </section>
  )
}












