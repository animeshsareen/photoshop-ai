import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { Inter, Nunito } from 'next/font/google'
import AuthSessionProvider from '@/components/session-provider'
import { ThemeProvider } from '@/components/theme-provider'
import Navigation from '@/components/navigation'
import './globals.css'

export const metadata: Metadata = {
  title: 'PhotoshopAI',
  description: 'AI photo editing & virtual try-on',
  generator: 'v0.app',
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico' },
    ],
    shortcut: ['/favicon.ico'],
    apple: [
      { url: '/apple-touch-icon.png' },
    ],
  },
}

// Fonts must be instantiated at module scope
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const nunito = Nunito({ subsets: ['latin'], variable: '--font-nunito' })

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
  <body className={`font-sans ${GeistSans.variable} ${GeistMono.variable} ${inter.variable} ${nunito.variable}`}>
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
