/** @owner Thomas */
"use client";

import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { StructuredCard } from "./StructuredCard";
import type { StructuredTask } from "@/lib/types/task";

export function ComposeBox() {
  const [rawText, setRawText] = useState("");
  const [structured, setStructured] = useState<StructuredTask | null>(null);

  return (
    <div className="space-y-6">
      <Textarea
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
        rows={5}
        placeholder="I need someone to pick up my package from the UC and bring it to Gates before 6. Max $10."
      />
      <Button
        type="button"
        onClick={async () => {
          // TODO(Thomas): POST /api/tasks
          void setStructured;
        }}
      >
        Send to my agent
      </Button>
      {structured ? <StructuredCard value={structured} onChange={setStructured} /> : null}
    </div>
  );
}
