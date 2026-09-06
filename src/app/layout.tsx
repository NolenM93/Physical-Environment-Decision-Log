import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Stanza — plan the room',
  description: 'Plan a room on a measured floor. Drag the furniture. See if everyone fits.',
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
