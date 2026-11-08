import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../lib/utils';

const buttonStyles = cva(
  'inline-flex items-center justify-center gap-2 font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-4 disabled:pointer-events-none disabled:opacity-60 cursor-pointer select-none',
  {
    variants: {
      variant: {
        primary:
          'bg-gradient-to-r from-indigo-600 via-indigo-600 to-indigo-700 text-white shadow-sm shadow-indigo-500/20 hover:from-indigo-700 hover:to-indigo-800 focus-visible:ring-indigo-500/30 active:scale-[0.98]',
        secondary:
          'border border-slate-200 bg-white text-slate-700 shadow-xs hover:bg-slate-50 hover:text-slate-900 focus-visible:ring-slate-300 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700 active:scale-[0.98]',
        ghost:
          'bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-slate-300 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200',
        danger:
          'bg-rose-600 text-white shadow-sm shadow-rose-500/20 hover:bg-rose-700 focus-visible:ring-rose-500/30 active:scale-[0.98]',
        success:
          'bg-emerald-600 text-white shadow-sm shadow-emerald-500/20 hover:bg-emerald-700 focus-visible:ring-emerald-500/30 active:scale-[0.98]',
        outline:
          'border border-indigo-200 text-indigo-600 hover:bg-indigo-50 active:scale-[0.98] dark:border-indigo-800 dark:text-indigo-400 dark:hover:bg-indigo-950',
      },
      size: {
        sm: 'px-3 py-1.5 text-xs rounded-lg',
        md: 'px-4 py-2.5 text-sm rounded-xl',
        lg: 'px-5 py-3 text-base rounded-xl',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

type Props = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonStyles> & {
    asChild?: boolean;
    loading?: boolean;
  };

export function Button({
  variant,
  size,
  className,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: Props) {
  const Component = asChild ? Slot : 'button';
  return (
    <Component
      className={cn(buttonStyles({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <svg
          className="h-4 w-4 animate-spin text-current"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      )}
      {children}
    </Component>
  );
}
