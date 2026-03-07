import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import '@/index.css' // Import existing globals
import AppLayout from "@/components/AppLayout"
import { Providers } from "@/components/Providers"

const inter = Inter({ subsets: ['latin'] })

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
            <body className={inter.className}>
                <Providers>
                    <AppLayout>
                        {children}
                    </AppLayout>
                </Providers>
            </body>
        </html>
    )
}
