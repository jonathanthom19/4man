'use client';

import dynamic from 'next/dynamic';

// Skip SSR entirely — DraftBoard relies on localStorage, polling, and other
// browser-only APIs. Loading it client-side ensures the Next.js App Router is
// fully initialized before any of its effects fire, which prevents the
// "Router action dispatched before initialization" error in dev mode.
const DraftBoard = dynamic(() => import('@/components/DraftBoard'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
    </div>
  ),
});

export default function Home() {
  return <DraftBoard />;
}
