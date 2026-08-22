import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Stanza — a spatial decision log',
  description:
    'Reconstruct your room from ordinary photographs, rearrange the furniture you already own, and keep a record of why you chose what you chose.',
  applicationName: 'Stanza',
};

export const viewport: Viewport = {
  themeColor: '#0b0d10',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-ink-950">{children}</body>
    </html>
  );
}
