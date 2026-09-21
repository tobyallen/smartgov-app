import type { Metadata } from 'next';

// page.tsx here is a client component ('use client', for useChat) and so
// can't export metadata itself - a plain server layout wrapping it can.
export const metadata: Metadata = { title: 'Chat' };

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return children;
}
