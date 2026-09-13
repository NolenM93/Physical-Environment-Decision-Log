import type { Metadata, Viewport } from 'next';
import { Cormorant_Garamond, JetBrains_Mono, Source_Sans_3 } from 'next/font/google';
import './globals.css';

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-cormorant',
  display: 'swap',
});

const source = Source_Sans_3({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-source',
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Stanza — banquet floor',
  description:
    'Plan the reception and the dinner on one measured ballroom, then hand ops the flip.',
  applicationName: 'Stanza',
};

export const viewport: Viewport = {
  themeColor: '#c3b9ab',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`h-full antialiased ${cormorant.variable} ${source.variable} ${jetbrains.variable}`}
    >
      <body className="flex min-h-full flex-col bg-ink-950">{children}</body>
    </html>
  );
}
