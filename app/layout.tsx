import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import AuthSessionProvider from '@/components/session-provider'
import { ThemeProvider } from '@/components/theme-provider'
import Navigation from '@/components/navigation'
import './globals.css'

export const metadata: Metadata = {
  title: 'AI Photo Editor',
  description: 'Edit your photos with AI using natural language',
  generator: 'v0.app',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`font-sans ${GeistSans.variable} ${GeistMono.variable}`}>
        <ThemeProvider>
          <AuthSessionProvider>
            <Navigation />
            {children}
          </AuthSessionProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
