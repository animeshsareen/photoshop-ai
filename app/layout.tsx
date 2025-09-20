import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { Inter, Funnel_Sans } from 'next/font/google'
import AuthSessionProvider from '@/components/session-provider'
import { ThemeProvider } from '@/components/theme-provider'
import Navigation from '@/components/navigation'
import './globals.css'


// Fonts must be instantiated at module scope
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const funnelSans = Funnel_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-nunito',
  weight: ['300','400','500','600','700','800'],
  style: ['normal','italic'],
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
  <body className={`font-sans ${GeistSans.variable} ${GeistMono.variable} ${inter.variable} ${funnelSans.variable}`}>
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
