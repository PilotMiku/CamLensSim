import type { CSSProperties } from 'react';

export type IconName =
  | 'aperture'
  | 'camera'
  | 'lens'
  | 'focus'
  | 'grid'
  | 'reset'
  | 'help'
  | 'chevron'
  | 'sun'
  | 'sliders'
  | 'arrow'
  | 'close'
  | 'check'
  | 'move'
  | 'joystick'
  | 'rotate'
  | 'sound'
  | 'muted';
const paths: Record<IconName, React.ReactNode> = {
  aperture: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m12 3 5.2 9-5.2 9-5.2-9Zm-7.8 4.5h10.4m5.2 0-5.2 9m5.2 0H9.4m-5.2 0 5.2-9" />
    </>
  ),
  camera: (
    <>
      <path d="M8 6 9.5 4h5L16 6h4v13H4V6Z" />
      <circle cx="12" cy="12.5" r="3.5" />
    </>
  ),
  lens: (
    <>
      <rect x="6" y="4" width="12" height="16" rx="3" />
      <path d="M6 8h12M6 16h12M9 8v8m3-8v8m3-8v8" />
    </>
  ),
  focus: (
    <>
      <path d="M8 4H4v4m12-4h4v4M4 16v4h4m8 0h4v-4" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M9.3 4v16m5.4-16v16M4 9.3h16M4 14.7h16" />
    </>
  ),
  reset: (
    <>
      <path d="M4.5 10a8 8 0 1 1 1 7M4 4v6h6" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.2.7-1.5 1-1.5 2.5m0 3v.1" />
    </>
  ),
  chevron: <path d="m8 10 4 4 4-4" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
    </>
  ),
  sliders: (
    <>
      <path d="M5 4v16m7-16v16m7-16v16M2 9h6m1 6h6m1-8h6" />
    </>
  ),
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  move: (
    <>
      <path d="M12 3v18M3 12h18" />
      <path d="m8.5 6.5 3.5-3.5 3.5 3.5M8.5 17.5l3.5 3.5 3.5-3.5M6.5 8.5 3 12l3.5 3.5M17.5 8.5 21 12l-3.5 3.5" />
    </>
  ),
  joystick: (
    <>
      <circle cx="12" cy="18" r="4.2" />
      <path d="M12 13.8V7.5" />
      <circle cx="12" cy="5.2" r="2.4" />
    </>
  ),
  rotate: (
    <>
      <path d="M20 12a8 8 0 1 1-2.4-5.7" />
      <path d="M20 4v5h-5" />
    </>
  ),
  close: <path d="m6 6 12 12M6 18 18 6" />,
  sound: <><path d="M11 4 6 8H3v8h3l5 4Z" /><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></>,
  muted: <><path d="M11 4 6 8H3v8h3l5 4Z" /><path d="m16 9 6 6m0-6-6 6" /></>,
  check: <path d="m5 12 4 4L19 6" />,
};
export function Icon({
  name,
  size = 18,
  style,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      {paths[name]}
    </svg>
  );
}