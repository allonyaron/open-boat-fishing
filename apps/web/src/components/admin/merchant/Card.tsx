import type { HTMLAttributes, ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`bg-merchant-surface border border-merchant-hairline rounded-xl shadow-[0_1px_0_rgba(0,0,0,0.05)] overflow-hidden ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3.5">
      <div>
        <div className="text-15 font-bold text-merchant-ink">{title}</div>
        {subtitle && <div className="text-13 text-merchant-muted mt-0.5">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

export function CardRow({
  children,
  className = "",
  ...rest
}: { children: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`border-t border-merchant-hairline px-4 py-3.5 ${className}`} {...rest}>
      {children}
    </div>
  );
}
