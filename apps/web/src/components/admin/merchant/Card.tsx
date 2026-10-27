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
