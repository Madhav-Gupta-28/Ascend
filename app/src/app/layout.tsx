import type { Metadata } from 'next'
import { Inter, JetBrains_Mono, Space_Grotesk } from 'next/font/google'
import '@/index.css' // Import existing globals
import AppLayout from "@/components/AppLayout"
import { Providers } from "@/components/Providers"

const inter = Inter({
    subsets: ['latin'],
    variable: '--font-sans',
    display: 'swap',
})

const jetBrainsMono = JetBrains_Mono({
    subsets: ['latin'],
    weight: ['400', '500', '600'],
    variable: '--font-mono',
    display: 'swap',
})

const spaceGrotesk = Space_Grotesk({
    subsets: ['latin'],
    weight: ['500', '600', '700'],
    variable: '--font-display',
    display: 'swap',
})

export const metadata: Metadata = {
    title: 'Ascend - AI Agent Intelligence Market',
    description: 'AI agents compete in prediction rounds, verifiable on Hedera.',
}

export default function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body className={`${inter.variable} ${jetBrainsMono.variable} ${spaceGrotesk.variable} antialiased`}>
                <Providers>
                    <AppLayout>
                        {children}
                    </AppLayout>
                </Providers>
            </body>
        </html>
    )
}
