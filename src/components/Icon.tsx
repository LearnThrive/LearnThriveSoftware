import type { CSSProperties } from 'react';

export type IconName = 'microphone' | 'microphone-off' | 'camera' | 'camera-off' | 'arrow' | 'plus' | 'link' | 'check' | 'leave' | 'people' | 'shield' | 'info' | 'refresh' | 'volume' | 'spark'
  | 'screen' | 'screen-off' | 'chat' | 'settings' | 'send' | 'expand' | 'collapse' | 'flip' | 'close' | 'pip' | 'hand';

export function Icon({ name, size = 20, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  const paths: Record<IconName, React.ReactNode> = {
    microphone: <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" /></>,
    'microphone-off': <><path d="m3 3 18 18M9 9v3a3 3 0 0 0 5 2M9 5a3 3 0 0 1 6 0v6M5 10v2a7 7 0 0 0 12 5m2-7v2a7 7 0 0 1-.2 1.7M12 19v3m-4 0h8" /></>,
    camera: <><rect x="2" y="5" width="14" height="14" rx="3" /><path d="m16 10 6-4v12l-6-4" /></>,
    'camera-off': <><path d="m3 3 18 18M9 5h4a3 3 0 0 1 3 3v2l6-4v12l-6-4M16 17a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V8a3 3 0 0 1 1-2" /></>,
    arrow: <><path d="M5 12h14m-5-5 5 5-5 5" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    link: <><path d="m10 13 4-4m-6 6-1 1a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0m2 2 1-1a3.5 3.5 0 0 1 5 5l-4 4a3.5 3.5 0 0 1-5 0" transform="translate(1 0)" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    leave: <><path d="M3 15a2 2 0 0 0 2 1l3-1a2 2 0 0 0 1-2v-2a13 13 0 0 1 6 0v2a2 2 0 0 0 1 2l3 1a2 2 0 0 0 2-1l1-3C17 6 7 6 2 12z" /></>,
    people: <><circle cx="9" cy="7" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 5a5 5 0 0 1 3 4v2" /></>,
    shield: <><path d="m12 2 8 3v6c0 5-8 10-8 10S4 16 4 11V5z" /><path d="m8 11 3 3 5-6" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v.1" /></>,
    refresh: <><path d="M20 10a8 8 0 1 0-2 8M20 4v6h-6" /></>,
    volume: <><path d="m11 4-6 5H2v6h3l6 5zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></>,
    spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z" /></>,
    screen: <><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
    'screen-off': <><path d="m3 3 18 18M8 21h8M12 17v4M6 4h14a2 2 0 0 1 2 2v9M2 8v7a2 2 0 0 0 2 2h4" /></>,
    chat: <><rect x="3" y="5" width="18" height="12" rx="3" /><path d="m8 17-2 3v-3" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3m0 14v3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M2 12h3m14 0h3M4.2 19.8l2.1-2.1m11.4-11.4 2.1-2.1" /></>,
    send: <path d="m3 11 18-8-8 18-2-8-8-2z" />,
    expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
    collapse: <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />,
    flip: <><path d="M4 12a8 8 0 0 1 14.5-4.5M20 12a8 8 0 0 1-14.5 4.5" /><path d="M18.5 3v4.5H14M5.5 21v-4.5H10" /></>,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    pip: <><rect x="2" y="4" width="20" height="14" rx="2" /><rect x="12" y="11" width="8" height="6" rx="1" fill="currentColor" stroke="none" /></>,
    hand: <><path d="M8 12V5a1.5 1.5 0 0 1 3 0v5M11 10V4a1.5 1.5 0 0 1 3 0v6M14 10V5a1.5 1.5 0 0 1 3 0v7" /><path d="M17 11v-1a1.5 1.5 0 0 1 3 0v4a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3.4l-2.7-4.5a1.4 1.4 0 0 1 2.3-1.6L8 14" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{paths[name]}</svg>;
}
