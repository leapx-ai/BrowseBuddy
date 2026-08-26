/*
 * Line icons.
 *
 * The empty states used emoji (📭 🛡️ ⭐ 📊) and the star button used ★/☆. Emoji
 * are rendered by the OS font: weight, colour and baseline all differ per
 * platform and none of them follow the theme, which is why they read as
 * placeholder art. These are strokes on currentColor, so they inherit text
 * colour and both themes get the same shape.
 *
 * Icons are decorative here - every one of them sits next to a text label or on
 * a control that already carries an aria-label - so the svg is aria-hidden and
 * exposes nothing to a screen reader.
 */
import React from 'react';

export type IconName = 'inbox' | 'shield' | 'star' | 'star-filled' | 'chart' | 'chevron-down' | 'chevron-right' | 'close' | 'plus' | 'check' | 'eye';

const PATHS: Record<IconName, React.ReactNode> = {
  inbox: (
    <>
      <path d="M3 13h4l1.5 3h7L17 13h4" />
      <path d="M6 4h12l3 9v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6L6 4Z" />
    </>
  ),
  shield: <path d="M12 3l7 3v5.5c0 4.2-2.9 7.9-7 9.5-4.1-1.6-7-5.3-7-9.5V6l7-3Z" />,
  star: <path d="M12 4.5l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 10.2l5.4-.8L12 4.5Z" />,
  'star-filled': (
    <path
      d="M12 4.5l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 10.2l5.4-.8L12 4.5Z"
      fill="currentColor"
    />
  ),
  chart: (
    <>
      <path d="M4 20V10M10 20V5M16 20v-7M22 20H2" />
    </>
  ),
  'chevron-down': <path d="M6 9.5l6 6 6-6" />,
  'chevron-right': <path d="M9.5 6l6 6-6 6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M20 6L9 17l-5-5" />,
  eye: (
    <>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
};

export const Icon: React.FC<{ name: IconName; size?: number; className?: string }> = ({
  name,
  size = 16,
  className,
}) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {PATHS[name]}
  </svg>
);

export default Icon;
