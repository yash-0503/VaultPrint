import Link from "next/link";

import { ReceiverClient } from "@/components/ReceiverClient";

export default function ReceivePage() {
  return (
    <main className="vault-receive-page mx-auto max-w-2xl px-4 py-10">
      <header className="no-print mb-8 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-vault-emerald">
          VaultPrint — Receiver
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-vault-navy">
          Secure print preview
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-slate-600">
          Enter the customer session code. The document streams encrypted peer-to-peer and is held only
          in memory. Nothing is saved to this computer — still, use a trusted workstation.
        </p>
      </header>

      <ReceiverClient />
    </main>
  );
}
