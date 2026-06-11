"use client";

import { useCallback, useId, useState } from "react";

const ACCEPT =
  "application/pdf,image/png,image/jpeg,image/webp,image/gif,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface QueuedFile {
  file: File;
  buffer: ArrayBuffer;
}

export interface FileDropzoneProps {
  disabled?: boolean;
  fileLabels: string[];
  onFiles: (items: QueuedFile[]) => void;
}

export function FileDropzone({ disabled, fileLabels, onFiles }: FileDropzoneProps) {
  const inputId = useId();
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = useCallback(
    async (list: FileList | null) => {
      if (!list?.length || disabled) {
        return;
      }
      const items: QueuedFile[] = [];
      for (let i = 0; i < list.length; i++) {
        const file = list[i];
        if (!file) {
          continue;
        }
        const buffer = await file.arrayBuffer();
        items.push({ file, buffer });
      }
      if (items.length > 0) {
        onFiles(items);
      }
    },
    [disabled, onFiles],
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
        multiple
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <label
        htmlFor={inputId}
        className={`block cursor-pointer rounded-xl py-3 text-sm font-medium ${
          disabled ? "cursor-not-allowed" : ""
        }`}
      >
        <span className="text-vault-navy">Drop PDFs or images here</span>
        <span className="block text-slate-500">or tap to browse (multiple files OK)</span>
      </label>
      {fileLabels.length > 0 ? (
        <ul className="mt-3 space-y-1 text-left text-xs font-semibold text-vault-emerald">
          {fileLabels.map((label, index) => (
            <li key={`${label}-${index}`} className="truncate">
              {label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
