import Link from "next/link";

import { SenderClient } from "@/components/SenderClient";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-8 px-4 py-10">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-vault-emerald">
          VaultPrint
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-vault-navy">
          Send a confidential print job
        </h1>
        <p className="text-sm leading-relaxed text-slate-600">
          PDFs and images stay on your phone until they reach the shop PC over an
          encrypted peer-to-peer link. We never upload your document to our servers.
        </p>
      </header>

      <SenderClient />

    </main>
  );
}
