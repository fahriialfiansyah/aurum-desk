import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Toaster } from 'sonner';
import './globals.css';

export const metadata: Metadata = {
  title: 'aurum-desk · XAUUSD agent trading desk',
  description: 'Meja analisa XAUUSD — struktur pasar, supply/demand, dan agen AI. Bukan saran finansial.',
  icons: { icon: '/favicon.svg' },
};

export const viewport: Viewport = { themeColor: '#0b0d10', width: 'device-width', initialScale: 1 };

const THEME_BOOT = `(function(){try{var t=localStorage.getItem('aurum-theme');document.documentElement.dataset.theme=(t==='light'||t==='dark')?t:'dark';}catch(e){document.documentElement.dataset.theme='dark';}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id" suppressHydrationWarning data-theme="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="min-h-dvh bg-bg text-fg">
        {children}
        <Toaster position="bottom-right" closeButton duration={5000} visibleToasts={4} theme="system" toastOptions={{ className: 'font-mono text-[12px]' }} />
      </body>
    </html>
  );
}
