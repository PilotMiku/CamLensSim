import { useId, useState } from 'react';

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
  marks?: string[];
  disabled?: boolean;
  logarithmic?: boolean;
}

const decimalsFor = (step: number) => (step >= 1 ? 0 : step >= 0.1 ? 1 : 2);

export function ParameterControl({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  marks,
  disabled = false,
  logarithmic = false,
}: Props) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const decimals = decimalsFor(step);
  const display = editing ? draft : value.toFixed(decimals);
  const progress =
    max === min
      ? 0
      : logarithmic
        ? Math.log(Math.max(value, min) / min) / Math.log(max / min)
        : (value - min) / (max - min);

  const commit = () => {
    const number = Number(draft);
    if (draft.trim() && Number.isFinite(number)) {
      const clamped = Math.min(max, Math.max(min, number));
      setEditing(false);
      onChange(clamped);
    } else setEditing(false);
  };

  return (
    <div className={`parameter ${disabled ? 'is-disabled' : ''}`}>
      <div className="parameter-heading">
        <label htmlFor={`${id}-number`}>{label}</label>
        <span className="number-field">
          {unit === 'f /' && <span>f/</span>}
          <input
            id={`${id}-number`}
            type="number"
            inputMode="decimal"
            value={display}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            onFocus={() => {
              setDraft(value.toFixed(decimals));
              setEditing(true);
            }}
            onChange={(event) => {
              setDraft(event.target.value);
              setEditing(true);
            }}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commit();
                event.currentTarget.blur();
              }
            }}
          />
          {unit !== 'f /' && <span>{unit}</span>}
        </span>
      </div>
      <input
        className="range-input"
        aria-label={`${label}滑块`}
        type="range"
        min={logarithmic ? 0 : min}
        max={logarithmic ? 1000 : max}
        step={logarithmic ? 1 : step}
        value={logarithmic ? Math.round(progress * 1000) : value}
        disabled={disabled}
        style={{ '--progress': `${progress * 100}%` } as React.CSSProperties}
        onChange={(event) => {
          const raw = Number(event.target.value);
          const next = logarithmic ? min * Math.pow(max / min, raw / 1000) : raw;
          onChange(Math.round(next / step) * step);
        }}
      />
      {marks && (
        <div className="range-marks" aria-hidden="true">
          {marks.map((mark) => (
            <span key={mark}>{mark}</span>
          ))}
        </div>
      )}
    </div>
  );
}
