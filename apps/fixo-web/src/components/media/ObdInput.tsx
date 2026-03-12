"use client";

import { Plus, Send, Trash2, X } from "lucide-react";
import { useState } from "react";

interface ObdInputProps {
  onSubmit: (codes: string[]) => void;
  onClose: () => void;
}

const OBD_PATTERN = /^[PBCU]\d{4}$/i;

export function ObdInput({ onSubmit, onClose }: ObdInputProps) {
  const [codes, setCodes] = useState<string[]>([""]);
  const [errors, setErrors] = useState<(string | null)[]>([null]);

  const updateCode = (index: number, value: string) => {
    const upper = value
      .toUpperCase()
      .replace(/[^PBCU0-9]/g, "")
      .slice(0, 5);
    const newCodes = [...codes];
    newCodes[index] = upper;
    setCodes(newCodes);

    const newErrors = [...errors];
    if (upper.length === 5 && !OBD_PATTERN.test(upper)) {
      newErrors[index] = "Invalid format (e.g. P0171)";
    } else {
      newErrors[index] = null;
    }
    setErrors(newErrors);
  };

  const addCode = () => {
    setCodes([...codes, ""]);
    setErrors([...errors, null]);
  };

  const removeCode = (index: number) => {
    if (codes.length <= 1) return;
    setCodes(codes.filter((_, i) => i !== index));
    setErrors(errors.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    const validCodes = codes.filter((c) => OBD_PATTERN.test(c));
    if (validCodes.length === 0) return;
    onSubmit(validCodes);
    onClose();
  };

  const hasValidCodes = codes.some((c) => OBD_PATTERN.test(c));

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-surface border-t border-border rounded-t-2xl p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Enter OBD Codes</h3>
        <button
          type="button"
          onClick={onClose}
          className="p-1 text-text-secondary hover:text-text"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <p className="text-text-secondary text-sm mb-4">
        Enter diagnostic trouble codes (e.g. P0171, B0001, C0035, U0100)
      </p>

      <div className="space-y-3 mb-4 max-h-48 overflow-y-auto">
        {codes.map((code, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: dynamic list of code inputs
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              value={code}
              onChange={(e) => updateCode(i, e.target.value)}
              placeholder="P0171"
              maxLength={5}
              className="flex-1 bg-surface-alt border border-border rounded-xl px-4 py-2.5 text-sm font-mono uppercase text-text placeholder-text-secondary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors"
              // biome-ignore lint/a11y/noAutofocus: focus newest input for UX
              autoFocus={i === codes.length - 1}
            />
            {codes.length > 1 && (
              <button
                type="button"
                onClick={() => removeCode(i)}
                className="p-2 text-text-secondary hover:text-red-500"
                aria-label="Remove code"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>

      {errors.some((e) => e) && (
        <p className="text-xs text-red-500 mb-3">{errors.find((e) => e)}</p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={addCode}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-surface-alt text-text-secondary text-sm hover:text-text transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add code
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!hasValidCodes}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-white font-medium disabled:opacity-30 transition-opacity"
        >
          <Send className="w-4 h-4" />
          Analyze {codes.filter((c) => OBD_PATTERN.test(c)).length || ""} code
          {codes.filter((c) => OBD_PATTERN.test(c)).length !== 1 ? "s" : ""}
        </button>
      </div>
    </div>
  );
}
