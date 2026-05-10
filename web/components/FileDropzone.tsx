"use client";

import { useCallback, useId, useState } from "react";

const ACCEPT =
  "application/pdf,image/png,image/jpeg,image/webp,image/gif,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface FileDropzoneProps {
  disabled?: boolean;
  fileLabel: string | null;
  onFile: (file: File, buffer: ArrayBuffer) => void;
}

export function FileDropzone({ disabled, fileLabel, onFile }: FileDropzoneProps) {
  const inputId = useId();
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = useCallback(
    async (list: FileList | null) => {
      const file = list?.[0];
      if (!file || disabled) {
        return;
      }
      const buffer = await file.arrayBuffer();
      onFile(file, buffer);
    },
    [disabled, onFile],
  );

  return (
    <div
      className={`rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
        dragOver ? "border-vault-emerald bg-emerald-50" : "border-slate-200 bg-white"
      } ${disabled ? "opacity-50" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) {
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        void handleFiles(e.dataTransfer.files);
      }}
    >
      <input
        id={inputId}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        disabled={disabled}
        onChange={(e) => void handleFiles(e.target.files)}
      />
      <label
        htmlFor={inputId}
        className={`block cursor-pointer rounded-xl py-3 text-sm font-medium ${
          disabled ? "cursor-not-allowed" : ""
        }`}
      >
        <span className="text-vault-navy">Drop a PDF or image here</span>
        <span className="block text-slate-500">or tap to browse</span>
      </label>
      {fileLabel ? (
        <p className="mt-3 truncate text-xs font-semibold text-vault-emerald">{fileLabel}</p>
      ) : null}
    </div>
  );
}
