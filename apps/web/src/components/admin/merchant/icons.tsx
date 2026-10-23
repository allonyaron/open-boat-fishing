import type { ReactNode } from "react";

/** Line icons from the admin v2 mockup. Decorative: the button or link next to them carries the name. */
function Svg({ size = 18, stroke = 2, children }: { size?: number; stroke?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="flex-none"
    >
      {children}
    </svg>
  );
}

type IconProps = { size?: number };

export const PlusIcon = ({ size }: IconProps) => (
  <Svg size={size} stroke={2.5}>
    <path d="M5 12h14M12 5v14" />
  </Svg>
);

export const CalendarIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <rect width="18" height="18" x="3" y="4" rx="1" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </Svg>
);

export const PeopleIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </Svg>
);

/** Stop sign — required on every Cancel-type danger button. */
export const StopIcon = ({ size }: IconProps) => (
  <Svg size={size} stroke={2.5}>
    <circle cx="12" cy="12" r="10" />
    <path d="m4.9 4.9 14.2 14.2" />
  </Svg>
);

/** Undo arrow — the Refund danger button's icon. */
export const UndoIcon = ({ size }: IconProps) => (
  <Svg size={size} stroke={2.5}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Svg>
);

export const ChevronRightIcon = ({ size = 16 }: IconProps) => (
  <Svg size={size} stroke={2.5}>
    <path d="m9 18 6-6-6-6" />
  </Svg>
);

export const ChevronLeftIcon = ({ size = 16 }: IconProps) => (
  <Svg size={size} stroke={2.5}>
    <path d="m15 18-6-6 6-6" />
  </Svg>
);

export const CloseIcon = ({ size = 22 }: IconProps) => (
  <Svg size={size}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);

export const MenuIcon = ({ size = 24 }: IconProps) => (
  <Svg size={size}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Svg>
);

export const SunIcon = ({ size = 18 }: IconProps) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </Svg>
);

export const WarningIcon = ({ size = 20 }: IconProps) => (
  <Svg size={size}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4M12 17h.01" />
  </Svg>
);

export const PhoneIcon = ({ size = 16 }: IconProps) => (
  <Svg size={size}>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.58 2.81.7A2 2 0 0 1 22 16.92z" />
  </Svg>
);

export const PrintIcon = ({ size = 18 }: IconProps) => (
  <Svg size={size}>
    <path d="M6 9V2h12v7" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <path d="M6 14h12v8H6z" />
  </Svg>
);

export const CheckIcon = ({ size = 18 }: IconProps) => (
  <Svg size={size} stroke={3}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
);

export const CheckAllIcon = ({ size = 18 }: IconProps) => (
  <Svg size={size} stroke={2.5}>
    <path d="M18 6 7 17l-5-5M22 10l-7.5 7.5L13 16" />
  </Svg>
);

export const NoteIcon = ({ size = 18 }: IconProps) => (
  <Svg size={size}>
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
    <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
  </Svg>
);
