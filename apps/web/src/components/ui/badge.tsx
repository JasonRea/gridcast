import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide num',
  {
    variants: {
      variant: {
        default: 'bg-secondary text-foreground',
        muted: 'bg-secondary text-muted-foreground',
        live: 'bg-live/15 text-live',
        stale: 'bg-stale/15 text-stale',
        positive: 'bg-positive/15 text-positive',
        negative: 'bg-negative/15 text-negative',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
