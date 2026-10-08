"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Starting a new intent after uncertainty is explicit, never a transport retry. */
export function UncertainEnqueue({
  busy,
  retry,
  startNew,
}: {
  busy: boolean;
  retry: () => void;
  startNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={busy} onClick={retry}>
        Bestätigung erneut anfordern
      </Button>
      <Button variant="outline" disabled={busy} onClick={() => setOpen(true)}>
        Als neuen Auftrag einreihen
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Wirklich einen neuen Auftrag beginnen?</AlertDialogTitle>
            <AlertDialogDescription>
              Der bisherige Auftrag kann bereits eingereiht sein. Prüfe zuerst die Queue. Ein neuer
              Auftrag verwendet einen neuen Schlüssel und kann denselben Inhalt doppelt laden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={startNew}>Neuen Auftrag bestätigen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
