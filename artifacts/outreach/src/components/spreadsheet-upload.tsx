import { useRef, useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { useImportLeads, type LeadInput } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useRefreshAll, errMsg } from "@/components/bits";
import { leadsFromFiles } from "@/lib/lead-import";

/** Pick one or more CSV/Excel files and see who will be imported. */
export function SpreadsheetPicker({ onParsed }: { onParsed: (leads: LeadInput[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [names, setNames] = useState<string[]>([]);
  const [leads, setLeads] = useState<LeadInput[]>([]);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const { toast } = useToast();

  const pick = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try {
      const out = await leadsFromFiles(files);
      setNames(files.map((f) => f.name)); setLeads(out); setShowAll(false); onParsed(out);
      if (!out.length) toast({ title: "No people found in that file", description: "Make sure it has a header row with columns like Name, Company, Email or Phone.", variant: "destructive" });
    } catch (e) {
      toast({ title: "Couldn't read that file", description: errMsg(e), variant: "destructive" });
    } finally { setBusy(false); if (input.current) input.current.value = ""; }
  };

  const count = (f: (l: LeadInput) => unknown) => leads.filter(f).length;
  return (
    <div className="space-y-2">
      <input ref={input} type="file" multiple accept=".csv,.xlsx,.tsv,.txt" className="hidden" data-testid="input-spreadsheet"
        onChange={(e) => pick([...(e.target.files ?? [])])} />
      <button type="button" onClick={() => input.current?.click()} disabled={busy} data-testid="button-pick-spreadsheet"
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick([...e.dataTransfer.files]); }}
        className="flex w-full flex-col items-center gap-1 rounded-lg border-2 border-dashed border-border bg-background px-4 py-5 text-center hover:border-primary/50">
        <FileSpreadsheet className="h-6 w-6 text-muted-foreground" />
        <span className="text-sm font-medium">{busy ? "Reading..." : names.length ? names.join(", ") : "Upload a spreadsheet (Excel or CSV)"}</span>
        <span className="text-xs text-muted-foreground">Drop files here or click to choose. You can pick several at once, e.g. a company list and a contacts list. They're matched up by company name.</span>
      </button>
      {!!leads.length && (
        <div className="rounded-lg border border-border text-xs" data-testid="panel-spreadsheet-preview">
          <div className="border-b border-border bg-muted/40 px-3 py-1.5 text-muted-foreground" data-testid="text-spreadsheet-summary">
            <b className="text-foreground">{leads.length} people</b> · {count((l) => l.email)} with email · {count((l) => l.phone)} with phone · {count((l) => l.linkedinUrl)} with LinkedIn · {count((l) => l.firstName === "Team")} company-only (no named person)
          </div>
          <div className={`${showAll ? "max-h-72" : "max-h-40"} overflow-auto`}>
            {(showAll ? leads : leads.slice(0, 8)).map((l, i) => (
              <div key={i} className="grid grid-cols-3 gap-2 border-b border-border px-3 py-1.5 last:border-0">
                <b className="truncate">{l.firstName} {l.lastName}{l.title && <span className="ml-1 font-normal text-muted-foreground">{l.title}</span>}</b>
                <span className="truncate">{l.email ?? l.phone ?? "—"}</span>
                <span className="truncate text-muted-foreground">{l.company}</span>
              </div>
            ))}
            {leads.length > 8 && (
              <button type="button" onClick={() => setShowAll(!showAll)} className="w-full px-3 py-1.5 text-left font-medium text-primary hover:underline" data-testid="button-toggle-all-preview">
                {showAll ? "Show fewer" : `+ ${leads.length - 8} more (show all)`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Sends leads to the import endpoint in batches (keeps each request small for big sheets). */
export function useImportInBatches() {
  const imp = useImportLeads();
  const run = async (leads: LeadInput[], campaignId?: number) => {
    let imported = 0, skipped = 0;
    for (let i = 0; i < leads.length; i += 200) {
      const r = await imp.mutateAsync({ data: { leads: leads.slice(i, i + 200), campaignId } });
      imported += r.imported; skipped += r.skipped;
    }
    return { imported, skipped };
  };
  return { run, isPending: imp.isPending };
}

/** Upload a spreadsheet and add everyone in it straight to a campaign. */
export function SpreadsheetToCampaign({ campaignId, onDone }: { campaignId: number; onDone: () => void }) {
  const [leads, setLeads] = useState<LeadInput[]>([]);
  const imp = useImportInBatches();
  const refresh = useRefreshAll();
  const { toast } = useToast();
  return (
    <div className="space-y-2" data-testid="form-spreadsheet-campaign">
      <SpreadsheetPicker onParsed={setLeads} />
      {!!leads.length && (
        <div className="flex justify-end">
          <Button disabled={imp.isPending} data-testid="button-import-spreadsheet"
            onClick={() => imp.run(leads, campaignId).then((r) => { refresh(); toast({ title: `${r.imported} people added to this campaign` }); onDone(); },
              (e) => toast({ title: "Import failed", description: errMsg(e), variant: "destructive" }))}>
            {imp.isPending ? "Adding..." : `Add ${leads.length} people to campaign`}
          </Button>
        </div>
      )}
    </div>
  );
}
