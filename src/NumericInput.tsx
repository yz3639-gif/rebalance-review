import { useState, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange'> & {
  value: number;
  onValueChange: (value: number) => void;
};

const display = (value: number) => Number.isFinite(value) ? String(value) : '';

export default function NumericInput({ value, onValueChange, onFocus, onBlur, ...props }: Props) {
  // Keep the editable spelling separate from the numeric model: '' and '12.50'
  // must survive a keystroke, while real external value changes replace the draft.
  const [draft, setDraft] = useState(() => ({ value, text: display(value) }));
  if (!Object.is(draft.value, value)) setDraft({ value, text: display(value) });

  return <input {...props} type="number" inputMode="decimal" value={draft.text}
    onChange={event => {
      const text = event.currentTarget.value.replace(/^(-?)0+(?=\d)/, '$1');
      const numeric = Number(text);
      setDraft({ value: numeric, text });
      onValueChange(numeric);
    }}
    onFocus={event => {
      if (event.currentTarget.value === '0') event.currentTarget.select();
      onFocus?.(event);
    }}
    onBlur={event => {
      setDraft({ value, text: display(value) });
      onBlur?.(event);
    }}
  />;
}
