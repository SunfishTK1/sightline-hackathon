/** @owner Will */
"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { TERMS_SECTIONS } from "@/lib/terms";

export function TermsDialog({
  onAgree,
  onDecline,
}: {
  onAgree: () => void;
  /** "Not yet" - explicitly declining, not just closing without deciding. */
  onDecline: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className="underline underline-offset-2 hover:text-[var(--broker)]"
          />
        }
      >
        Terms of Service
      </DialogTrigger>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Terms of Service</DialogTitle>
        </DialogHeader>
        <ScrollArea className="-mx-4 h-[50vh] border-y border-[var(--border)] px-4 py-3">
          <div className="space-y-4 pr-2 text-sm text-[var(--ink)]">
            {TERMS_SECTIONS.map((section) => (
              <div key={section.heading} className="space-y-1.5">
                <h3 className="font-medium">{section.heading}</h3>
                {section.body.map((paragraph, i) => (
                  <p key={i} className="text-muted-foreground">
                    {paragraph}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </ScrollArea>
        <DialogFooter>
          <DialogClose
            render={<Button variant="outline" onClick={onDecline} />}
          >
            Not yet
          </DialogClose>
          <Button
            type="button"
            onClick={() => {
              onAgree();
              setOpen(false);
            }}
          >
            I agree
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
