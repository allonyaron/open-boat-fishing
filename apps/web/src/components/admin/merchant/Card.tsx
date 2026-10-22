import type { HTMLAttributes, ReactNode } from "react";

/** A ruled panel: panel background, 2px rule edge, 2px radius, no shadow. */
export function Panel({
  children,
  className = "",
  ...rest
}: { children: ReactNode; className?: string } & HTMLAttributes<HTMLElement>) {
  return (
    <section className={`bg-ob-panel border-2 border-ob-rule rounded-ob overflow-hidden ${className}`} {...rest}>
      {children}
    </section>
  );
}

/** Panel header: title-panel type, 16/20px padding, 2px rule under it. */
export function PanelHeader({
  title,
  subtitle,
  action,
  id,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  /** Set when the panel's content refers to the heading (aria-labelledby). */
  id?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b-2 border-ob-rule">
      <div className="min-w-0">
        <h2 id={id} className="text-title-panel text-ob-ink">
          {title}
        </h2>
        {subtitle && <div className="text-body-sm text-ob-ink-2 mt-0.5">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

/** A row inside a panel, divided from the one above by a 1px hair rule. */
export function PanelRow({
  children,
  className = "",
  ...rest
}: { children: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`border-t border-ob-hair first:border-t-0 px-5 py-4 ${className}`} {...rest}>
      {children}
    </div>
  );
}

// v1 names, kept so screens not yet rebuilt keep compiling.
export const Card = Panel;
export const CardHeader = PanelHeader;
export const CardRow = PanelRow;
