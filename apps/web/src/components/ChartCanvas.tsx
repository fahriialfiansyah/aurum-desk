'use client';

import { useRef } from 'react';
import { useChart, type UseChartArgs } from '@/chart/use-chart';

type Props = Omit<UseChartArgs, 'containerRef'> & { className?: string; testId?: string };

/** Thin DOM host for a lightweight-charts instance. */
export function ChartCanvas({ className, testId, ...args }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useChart({ ...args, containerRef });
  return <div ref={containerRef} data-testid={testId} className={className ?? 'h-full w-full'} />;
}
