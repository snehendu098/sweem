export type IconName =
  | "bank"
  | "billing"
  | "box"
  | "chevronDown"
  | "code"
  | "customer"
  | "developer"
  | "feedback"
  | "home"
  | "invoice"
  | "link"
  | "payment"
  | "plus"
  | "settings"
  | "support"
  | "user";

const paths: Record<IconName, React.ReactNode> = {
  bank: (
    <>
      <path d="M4 10.5h16" />
      <path d="M5.5 18h13" />
      <path d="M7 10.5v7.5M11 10.5v7.5M15 10.5v7.5" />
      <path d="m4.75 9 7.25-4 7.25 4" />
    </>
  ),
  billing: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3v4M16 3v4M4 10h16" />
      <path d="M16.5 14.25h.01M12 14.25h.01M7.5 14.25h.01" />
    </>
  ),
  box: (
    <>
      <path d="m12 3.75 7.25 4.1v8.3L12 20.25l-7.25-4.1v-8.3L12 3.75Z" />
      <path d="M4.95 8 12 12l7.05-4M12 20v-8" />
    </>
  ),
  chevronDown: <path d="m6 9 6 6 6-6" />,
  code: (
    <>
      <rect x="4.5" y="4.5" width="15" height="15" rx="2.5" />
      <path d="m10 9-3 3 3 3M14 9l3 3-3 3" />
    </>
  ),
  customer: (
    <>
      <path d="M16 19v-1.25c0-1.8-1.55-3.25-3.45-3.25h-5.1C5.55 14.5 4 15.95 4 17.75V19" />
      <circle cx="10" cy="8" r="3" />
      <path d="M20 19v-1.15a3.2 3.2 0 0 0-2.35-3.05M16.5 5.4a3 3 0 0 1 0 5.2" />
    </>
  ),
  developer: (
    <>
      <rect x="4.5" y="5" width="15" height="14" rx="2.5" />
      <path d="m10 9.5-2.5 2.5 2.5 2.5M14 9.5l2.5 2.5-2.5 2.5" />
    </>
  ),
  feedback: (
    <>
      <path d="m14.5 5.5 4 4" />
      <path d="M5 19h4l9.25-9.25a2.82 2.82 0 0 0-4-4L5 15v4Z" />
      <path d="M3.5 21h17" />
    </>
  ),
  home: (
    <>
      <path d="m4 10 8-6.5 8 6.5" />
      <path d="M6.5 9.5V19h11V9.5" />
      <path d="M10 19v-5h4v5" />
    </>
  ),
  invoice: (
    <>
      <path d="M6.5 4.5h11v15l-2-1.25-2 1.25-2-1.25-2 1.25-2-1.25-1 1.25v-15Z" />
      <path d="M9 8.5h6M9 12h6M9 15.5h4" />
    </>
  ),
  link: (
    <>
      <path d="M10.25 13.75a4.25 4.25 0 0 0 6.01.01l2.25-2.25a4.25 4.25 0 0 0-6.01-6.01l-1.3 1.3" />
      <path d="M13.75 10.25a4.25 4.25 0 0 0-6.01-.01L5.49 12.5a4.25 4.25 0 0 0 6.01 6.01l1.3-1.3" />
    </>
  ),
  payment: (
    <>
      <rect x="3.5" y="6" width="17" height="12" rx="2" />
      <path d="M3.5 10h17M7 15h2.5M16.5 15h.01" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14M5 12h14" />
    </>
  ),
  settings: (
    <>
      <path d="M12 8.25a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5Z" />
      <path d="M19.2 13.45a7.6 7.6 0 0 0 .04-2.9l2-1.54-2-3.46-2.5 1a7.55 7.55 0 0 0-2.5-1.46L13.9 2.5h-3.8l-.35 2.59a7.55 7.55 0 0 0-2.5 1.46l-2.5-1-2 3.46 2 1.54a7.6 7.6 0 0 0 .04 2.9l-2.04 1.55 2 3.46 2.55-1a7.55 7.55 0 0 0 2.45 1.42l.35 2.62h3.8l.35-2.62a7.55 7.55 0 0 0 2.45-1.42l2.55 1 2-3.46-2.04-1.55Z" />
    </>
  ),
  support: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="m7.8 7.8 2.85 2.85M16.2 7.8l-2.85 2.85M7.8 16.2l2.85-2.85M16.2 16.2l-2.85-2.85" />
      <circle cx="12" cy="12" r="2.35" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3" />
      <path d="M6.25 19c.5-3.05 2.45-4.6 5.75-4.6s5.25 1.55 5.75 4.6" />
    </>
  ),
};

export function Icon({
  name,
  size = 20,
  strokeWidth = 2.35,
  className,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
    >
      {paths[name]}
    </svg>
  );
}
