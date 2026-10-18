import { useId, useState } from 'react';
import { isAmountEntry, isValidAmount, normalizeAmountEntry } from './model';

/** String input preserves money exactly and rejects signs, exponents and non-numeric paste. */
export function AmountInput({
  label,
  value,
  onChange,
  disabled = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const invalid = touched && !isValidAmount(value);
  return (
    <label>
      {label}
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? id : undefined}
        value={value}
        onChange={(event) => {
          if (isAmountEntry(event.target.value)) onChange(event.target.value);
        }}
        onBlur={() => {
          setTouched(true);
          onChange(normalizeAmountEntry(value));
        }}
        required
        disabled={disabled}
        placeholder={placeholder}
      />
      {invalid && (
        <span id={id} className="field-error">
          Enter an amount greater than zero using digits and a decimal point.
        </span>
      )}
    </label>
  );
}
