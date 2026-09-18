"use client";

import dynamic from 'next/dynamic';

const ClassroomApp = dynamic(() => import('./App').then((mod) => mod.ClassroomApp), {
  ssr: false,
  loading: () => (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: '#0e2a47', color: '#ffffff' }}>
      <p style={{ fontFamily: 'var(--font-public-sans), sans-serif', fontSize: '1.125rem' }}>Loading classroom…</p>
    </div>
  ),
});

export function ClassroomClient(props: { lessonId?: string; initialToken?: string; isDevRoute?: boolean }) {
  return <ClassroomApp {...props} />;
}
