import { useId, type InputHTMLAttributes } from 'react';
import { cn } from '../lib/utils';

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
  containerClassName?: string;
};

export function TextField({
  label,
  hint,
  error,
  id,
  className,
  containerClassName,
  ...props
}: Props) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div className={cn('space-y-1.5', containerClassName)}>
      <label
        htmlFor={inputId}
        className="block text-sm font-semibold text-slate-700 dark:text-slate-200"
      >
        {label}
      </label>
      <input
        id={inputId}
        aria-describedby={error ? errorId : hintId}
        className={cn(
          'field',
          error && 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20',
          className
        )}
        {...props}
      />
      {error ? (
        <p id={errorId} className="text-xs font-medium text-rose-600 dark:text-rose-400">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs leading-5 text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
