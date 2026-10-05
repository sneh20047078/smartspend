import { useId, type InputHTMLAttributes } from 'react';

type Props = InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string };

export function TextField({ label, hint, id, ...props }: Props) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  return <div className="space-y-1.5">
    <label htmlFor={inputId} className="block text-sm font-semibold text-slate-700">{label}</label>
    <input id={inputId} aria-describedby={hintId} className="field" {...props} />
    {hint && <p id={hintId} className="text-xs leading-5 text-slate-500">{hint}</p>}
  </div>;
}
