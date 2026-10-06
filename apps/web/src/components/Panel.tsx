import type { ReactNode } from 'react';

type Props = { title: string; right?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string };

/** Modular-grid panel chrome: 1px borders, dense title row, scrollable body. */
export function Panel({ title, right, children, className = '', bodyClassName = '' }: Props) {
  return (
    <section className={`flex min-h-0 flex-col border border-line bg-elev ${className}`}>
      <header className="flex h-8 shrink-0 items-center justify-between border-b border-line px-3">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{title}</h2>
        {right ? <div className="flex items-center gap-2 text-[10px] text-muted">{right}</div> : null}
      </header>
      <div data-scroll className={`min-h-0 flex-1 overflow-auto scrollbar-thin-custom ${bodyClassName}`}>{children}</div>
    </section>
  );
}
