"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DecisionDiagnosis } from "@/components/decision-diagnosis";
import { readUiDiagnosis } from "@/lib/ui-diagnostics";
import type { DecisionReport } from "@/lib/decision-diagnostics";

export default function LogsPage() {
  const [report, setReport] = useState<DecisionReport | null>(null);
  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Diagnose</h1>
        <p className="text-muted-foreground text-sm">
          Geschlossene Entscheidungsgründe, keine Rohlogs
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Letzte Suchdiagnose dieses Browser-Tabs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Gespeichert höchstens fünf Minuten verfügbar; die Anzeige ist eine Momentaufnahme bis
            zum erneuten Lesen. Keine Suchtexte, Medien-URLs, Bibliotheksdaten, Tokens oder freien
            Exceptiontexte gespeichert. Ein neuer Suchversuch ersetzt den vorherigen Bericht.
          </p>
          <Button variant="outline" onClick={() => setReport(readUiDiagnosis())}>
            Gespeicherten Bericht lesen
          </Button>
          <DecisionDiagnosis report={report} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Die Zustände getrennt prüfen</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            <Link href="/search" className="underline">
              Suche
            </Link>{" "}
            /{" "}
            <Link href="/movies" className="underline">
              Filme
            </Link>
            : Katalog, Fassung und Beleggrenzen der jeweiligen Anfrage.
          </p>
          <p>
            <Link href="/downloads" className="underline">
              Downloads
            </Link>
            : Auftrag, lokale Dateiprüfung und optional zugeordneter Arr-Import. Completed allein
            bestätigt keinen Import.
          </p>
          <p>
            <Link href="/settings" className="underline">
              Settings
            </Link>
            : aktuelle Runtime-/Tool-/Backendbereitschaft.
          </p>
          <p className="text-muted-foreground">
            Pingufunk hat keinen eigenen Login. Zugriffsschutz der Installation gilt auch für diese
            Oberfläche und vorhandene APIs. Hier gibt es bewusst keinen globalen Diagnose-,
            Docker-/Shelllog- oder Rohantwort-Reader; eine UUID ist kein Zugriffsschutz. Diagnose
            löst keinen Retry, Grab, Override oder Import aus.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
