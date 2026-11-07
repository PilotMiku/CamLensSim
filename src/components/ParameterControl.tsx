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
  allowInfinity?: boolean;
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
  allowInfinity = false,
}: Props) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const decimals = decimalsFor(step);
  const atInfinity = allowInfinity && value === Infinity;
  const formatted = atInfinity ? '∞' : value.toFixed(decimals);
  const display = editing ? draft : formatted;
  const rangeMax = allowInfinity ? 1001 : 1000;
  const progress = atInfinity ? 1 : (
    max === min
      ? 0
      : logarithmic
        ? Math.log(Math.max(value, min) / min) / Math.log(max / min)
        : (value - min) / (max - min)) * (allowInfinity ? 1000 / rangeMax : 1);

  const commit = () => {
    if (allowInfinity && ['∞', 'infinity'].includes(draft.trim().toLowerCase())) {
      setEditing(false);
      onChange(Infinity);
      return;
    }
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
            type={allowInfinity ? 'text' : 'number'}
            inputMode="decimal"
            value={display}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            onFocus={() => {
              setDraft(formatted);
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
          {unit !== 'f /' && !atInfinity && <span>{unit}</span>}
        </span>
      </div>
      <input
        className="range-input"
        aria-label={`${label}滑块`}
        type="range"
        min={logarithmic ? 0 : min}
        max={logarithmic ? rangeMax : max}
        step={logarithmic ? 1 : step}
        value={logarithmic ? Math.round(progress * rangeMax) : value}
        disabled={disabled}
        aria-valuetext={atInfinity ? '无穷远' : undefined}
        style={{ '--progress': `${progress * 100}%` } as React.CSSProperties}
        onChange={(event) => {
          setEditing(false);
          const raw = Number(event.target.value);
          if (allowInfinity && raw === rangeMax) {
            onChange(Infinity);
            return;
          }
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
