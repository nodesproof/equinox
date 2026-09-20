import { Link } from "wouter";
import { ArrowUpRight, Construction } from "lucide-react";

import { SectionHeading, StatusPill } from "@/components/primitives";

// Placeholder rute yang halamannya dibangun di task berikutnya: tanpa angka, tanpa alamat, tanpa data palsu.
export default function ComingSoon({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="page-stack">
      <SectionHeading eyebrow="Coming next" title={title} detail={detail} action={<StatusPill tone="warn">Not built yet</StatusPill>} />
      <article className="panel">
        <div className="empty-state empty-state--wide">
          <div className="empty-state__icon"><Construction size={19} /></div>
          <strong>This surface lands in a later task</strong>
          <span>Until then nothing here is fabricated — no quotes, no counts, no addresses.</span>
          <Link href="/" className="soft-button">Back to overview <ArrowUpRight size={14} /></Link>
        </div>
      </article>
    </div>
  );
}
