import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import React from 'react'

import config from '@/lib/config'

import './globals.css'
import { Providers } from './providers'

export const metadata: Metadata = {
  title: config.appName,
  description: 'Operational console for the Record Platform.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
