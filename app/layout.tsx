import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tweets to PDF',
  description: 'Convert Twitter/X posts to downloadable PDFs',
  icons: {
    icon: '/favicon.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-100">{children}</body>
    </html>
  );
}
