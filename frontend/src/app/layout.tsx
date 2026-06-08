import type { Metadata } from 'next';
import { Providers } from '@/components/Providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Mandate Memory — Verifiable Agent Reasoning on Sui + Walrus',
  description: 'AI agents manage DeFi portfolios under Move-enforced mandates. Every reasoning cycle stored on Walrus. Every trade atomically enforced.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
