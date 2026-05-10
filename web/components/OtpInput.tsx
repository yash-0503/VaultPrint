"use client";

import {
  type ClipboardEvent,
  type KeyboardEvent,
  useCallback,
  useId,
  useRef,
} from "react";

export interface OtpInputProps {
  /** Number of digit boxes (6 or 8 — match server `SESSION_CODE_LENGTH`). */
  length: number;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

/**
 * Single-digit boxes; paste-friendly for shop staff.
 */
export function OtpInput({ length, value, onChange, disabled }: OtpInputProps) {
  const baseId = useId();
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  refs.current.length = length;

  const display = useCallback(
    (idx: number) => {
      const ch = value[idx];
      return ch && /\d/.test(ch) ? ch : "";
    },
    [value],
  );

  const setDigitAt = useCallback(
    (index: number, digit: string) => {
      const nextDigits: string[] = [];
      for (let i = 0; i < length; i++) {
        nextDigits[i] = value[i] && /\d/.test(value[i]!) ? value[i]! : "";
      }
      nextDigits[index] = digit;
      onChange(nextDigits.join(""));
    },
    [length, onChange, value],
  );

  const onKeyDown =
    (index: number) => (e: KeyboardEvent<HTMLInputElement>) => {
      if (
        e.key === "Backspace" &&
        (e.currentTarget.value === "" || !display(index))
      ) {
        if (index > 0) {
          refs.current[index - 1]?.focus();
        }
      }
      if (e.key === "ArrowLeft" && index > 0) {
        refs.current[index - 1]?.focus();
      }
      if (e.key === "ArrowRight" && index < length - 1) {
        refs.current[index + 1]?.focus();
      }
    };

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, length);
    if (text) {
      e.preventDefault();
      onChange(text);
    }
  };

  const boxClass =
    length > 6
      ? "h-12 w-10 sm:h-14 sm:w-11 rounded-lg border-2 border-slate-200 text-center text-xl sm:text-2xl font-bold tracking-widest text-vault-navy shadow-sm outline-none transition focus:border-vault-emerald"
      : "h-14 w-12 sm:w-14 rounded-xl border-2 border-slate-200 text-center text-2xl font-bold tracking-widest text-vault-navy shadow-sm outline-none transition focus:border-vault-emerald";

  return (
    <div
      className="flex flex-wrap justify-center gap-1.5 sm:gap-2"
      onPaste={onPaste}
    >
      {Array.from({ length }, (_, i) => (
        <input
          key={`${baseId}-${i}`}
          ref={(el) => {
            refs.current[i] = el;
          }}
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          disabled={disabled}
          value={display(i)}
          aria-label={`Session code digit ${i + 1} of ${length}`}
          className={boxClass}
          onChange={(e) => {
            const next = e.target.value.replace(/\D/g, "").slice(-1);
            setDigitAt(i, next);
            if (next && i < length - 1) {
              refs.current[i + 1]?.focus();
            }
          }}
          onKeyDown={onKeyDown(i)}
        />
      ))}
    </div>
  );
}
