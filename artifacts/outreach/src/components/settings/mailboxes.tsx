import { useState } from "react";
import { Mail, Plus, RefreshCw, Trash2, PlugZap } from "lucide-react";
import {
  useListMailboxes, useCreateMailbox, useUpdateMailbox, useDeleteMailbox, useTestMailbox, useSyncMailboxes,
} from "@workspace/api-client-react";
import type { Mailbox, MailboxInput } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Panel, Rows, ErrorBox, ago, chColor, useRefreshAll } from "@/components/bits";

/** Common providers: SMTP/IMAP hosts so users only type their address and app password. */
const PRESETS: Record<string, Partial<MailboxInput>> = {
  Gmail: { smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecure: true, imapHost: "imap.gmail.com", imapPort: 993, imapSecure: true },
  "Outlook / Microsoft 365": { smtpHost: "smtp.office365.com", smtpPort: 587, smtpSecure: false, imapHost: "outlook.office365.com", imapPort: 993, imapSecure: true },
  Zoho: { smtpHost: "smtp.zoho.com", smtpPort: 465, smtpSecure: true, imapHost: "imap.zoho.com", imapPort: 993, imapSecure: true },
  Custom: {},
};

export function MailboxesPanel({ delay = 0 }: { delay?: number }) {
  const q = useListMailboxes();
  const sync = useSyncMailboxes();
  const refresh = useRefreshAll();
  const { toast } = useToast();
  const [edit, setEdit] = useState<Mailbox | "new" | null>(null);
  return (
    <Panel title="Sending mailboxes" delay={delay} action={
      <div className="flex gap-1.5">
        <Button size="sm" variant="outline" disabled={sync.isPending || !q.data?.length} data-testid="button-sync-mailboxes"
          onClick={() => sync.mutate(undefined, { onSuccess: (r) => { refresh(); toast({ title: `Checked ${r.mailboxes} mailbox${r.mailboxes === 1 ? "" : "es"}`, description: r.errors.length ? r.errors.join("; ") : `${r.newReplies} new replies`, variant: r.errors.length ? "destructive" : undefined }); } })}>
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${sync.isPending ? "animate-spin" : ""}`} />Check replies</Button>
        <Button size="sm" onClick={() => setEdit("new")} data-testid="button-add-mailbox"><Plus className="mr-1 h-3.5 w-3.5" />Mailbox</Button>
      </div>}>
      {q.isLoading ? <Rows n={2} h={48} /> : q.isError ? <ErrorBox onRetry={() => q.refetch()} /> : !q.data?.length ? (
        <div className="p-4 text-sm text-muted-foreground">
          No mailbox connected, so emails are kept in-app only. Add Gmail, Outlook or any SMTP mailbox to send for real; add IMAP to detect replies automatically.
        </div>
      ) : (
        <div className="divide-y divide-border">{q.data.map((m) => <MailboxRow key={m.id} m={m} onEdit={() => setEdit(m)} />)}</div>
      )}
      {edit && <MailboxDialog mailbox={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </Panel>
  );
}

function MailboxRow({ m, onEdit }: { m: Mailbox; onEdit: () => void }) {
  const upd = useUpdateMailbox();
  const del = useDeleteMailbox();
  const test = useTestMailbox();
  const refresh = useRefreshAll();
  const { toast } = useToast();
  const pct = Math.min(100, (m.sentToday / Math.max(1, m.todayLimit)) * 100);
  return (
    <div className="flex flex-wrap items-center gap-3 p-4" data-testid={`row-mailbox-${m.id}`}>
      <div className="grid h-9 w-9 place-items-center rounded-lg" style={{ background: chColor("email", 0.12), color: chColor("email") }}><Mail className="h-4 w-4" /></div>
      <button className="min-w-0 flex-1 text-left" onClick={onEdit} data-testid={`button-edit-mailbox-${m.id}`}>
        <div className="truncate text-sm font-medium">{m.label} <span className="font-normal text-muted-foreground">· {m.fromEmail}</span></div>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-[hsl(var(--ch-email))]" style={{ width: `${pct}%` }} /></span>
          <span className="font-mono">{m.sentToday}/{m.todayLimit} today</span>
          {m.warmupEnabled && m.todayLimit < m.dailyLimit && <span>warming up to {m.dailyLimit}</span>}
          {m.imapHost ? <span>· replies synced {ago(m.lastSyncAt)}</span> : <span>· no reply sync</span>}
        </div>
        {m.lastError && <div className="mt-1 truncate text-xs text-destructive">{m.lastError}</div>}
      </button>
      <Button size="sm" variant="outline" disabled={test.isPending} data-testid={`button-test-mailbox-${m.id}`}
        onClick={() => test.mutate({ id: m.id }, { onSuccess: (r) => { refresh(); toast({ title: r.ok ? "Connected" : "Connection failed", description: r.message, variant: r.ok ? undefined : "destructive" }); } })}>
        <PlugZap className="mr-1 h-3.5 w-3.5" />{test.isPending ? "Testing..." : "Test"}</Button>
      <Switch checked={m.active} onCheckedChange={(v) => upd.mutate({ id: m.id, data: { active: v } }, { onSuccess: refresh })} data-testid={`switch-mailbox-active-${m.id}`} />
      <Button size="icon" variant="ghost" className="h-8 w-8 hover:text-destructive" disabled={del.isPending}
        onClick={() => del.mutate({ id: m.id }, { onSuccess: () => { refresh(); toast({ title: "Mailbox removed" }); } })} data-testid={`button-delete-mailbox-${m.id}`}><Trash2 className="h-4 w-4" /></Button>
    </div>
  );
}

type Form = Required<Omit<MailboxInput, "imapUser" | "imapPass">> & { imapUser: string; imapPass: string };

function MailboxDialog({ mailbox, onClose }: { mailbox: Mailbox | null; onClose: () => void }) {
  const create = useCreateMailbox();
  const upd = useUpdateMailbox();
  const refresh = useRefreshAll();
  const { toast } = useToast();
  const [f, setF] = useState<Form>({
    label: mailbox?.label ?? "", fromName: mailbox?.fromName ?? "", fromEmail: mailbox?.fromEmail ?? "",
    smtpHost: mailbox?.smtpHost ?? "", smtpPort: mailbox?.smtpPort ?? 587, smtpSecure: mailbox?.smtpSecure ?? false, smtpUser: mailbox?.smtpUser ?? "", smtpPass: "",
    imapHost: mailbox?.imapHost ?? "", imapPort: mailbox?.imapPort ?? 993, imapSecure: mailbox?.imapSecure ?? true, imapUser: mailbox?.imapUser ?? "", imapPass: "",
    dailyLimit: mailbox?.dailyLimit ?? 50, warmupEnabled: mailbox?.warmupEnabled ?? true, warmupStart: mailbox?.warmupStart ?? 5, warmupIncrement: mailbox?.warmupIncrement ?? 3,
  });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));
  const pending = create.isPending || upd.isPending;
  const valid = f.label && f.fromEmail && f.smtpHost && f.smtpUser && (mailbox || f.smtpPass);
  const save = () => {
    const done = { onSuccess: () => { refresh(); toast({ title: mailbox ? "Mailbox updated" : "Mailbox added", description: "Use Test to check the connection." }); onClose(); }, onError: () => toast({ title: "Could not save mailbox", variant: "destructive" }) };
    const data = { ...f, fromName: f.fromName || f.label };
    if (mailbox) upd.mutate({ id: mailbox.id, data }, done); else create.mutate({ data }, done);
  };
  const num = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display text-xl">{mailbox ? "Edit mailbox" : "Connect a mailbox"}</DialogTitle></DialogHeader>
        {!mailbox && (
          <div className="flex flex-wrap gap-1.5">{Object.keys(PRESETS).map((p) => (
            <button key={p} type="button" onClick={() => setF((x) => ({ ...x, ...PRESETS[p] }))} data-testid={`button-preset-${p.split(" ")[0]!.toLowerCase()}`}
              className="rounded-full border border-border px-3 py-1 text-xs hover:border-foreground">{p}</button>))}</div>
        )}
        <p className="text-xs text-muted-foreground">Gmail and Outlook need an app password (with 2-step verification on), not your normal password.</p>
        <div className="grid grid-cols-2 gap-2.5">
          <div><Label className="text-xs">Label</Label><Input value={f.label} onChange={(e) => set("label", e.target.value)} placeholder="Alex - Gmail" data-testid="input-mailbox-label" /></div>
          <div><Label className="text-xs">From name</Label><Input value={f.fromName} onChange={(e) => set("fromName", e.target.value)} data-testid="input-mailbox-from-name" /></div>
          <div className="col-span-2"><Label className="text-xs">From email</Label><Input value={f.fromEmail} onChange={(e) => { set("fromEmail", e.target.value); if (!mailbox) set("smtpUser", e.target.value); }} data-testid="input-mailbox-from-email" /></div>
          <div className="col-span-2 mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">SMTP (sending)</div>
          <div><Label className="text-xs">Host</Label><Input value={f.smtpHost} onChange={(e) => set("smtpHost", e.target.value)} data-testid="input-smtp-host" /></div>
          <div className="grid grid-cols-[1fr_auto] items-end gap-2"><div><Label className="text-xs">Port</Label><Input type="number" value={f.smtpPort} onChange={num("smtpPort")} data-testid="input-smtp-port" /></div>
            <label className="flex h-9 items-center gap-1.5 text-xs"><Switch checked={f.smtpSecure} onCheckedChange={(v) => set("smtpSecure", v)} />SSL</label></div>
          <div><Label className="text-xs">Username</Label><Input value={f.smtpUser} onChange={(e) => set("smtpUser", e.target.value)} data-testid="input-smtp-user" /></div>
          <div><Label className="text-xs">Password{mailbox && " (blank keeps current)"}</Label><Input type="password" value={f.smtpPass} onChange={(e) => set("smtpPass", e.target.value)} data-testid="input-smtp-pass" /></div>
          <div className="col-span-2 mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">IMAP (reply detection, optional)</div>
          <div><Label className="text-xs">Host</Label><Input value={f.imapHost} onChange={(e) => set("imapHost", e.target.value)} data-testid="input-imap-host" /></div>
          <div className="grid grid-cols-[1fr_auto] items-end gap-2"><div><Label className="text-xs">Port</Label><Input type="number" value={f.imapPort} onChange={num("imapPort")} data-testid="input-imap-port" /></div>
            <label className="flex h-9 items-center gap-1.5 text-xs"><Switch checked={f.imapSecure} onCheckedChange={(v) => set("imapSecure", v)} />SSL</label></div>
          <div><Label className="text-xs">Username (blank = SMTP)</Label><Input value={f.imapUser} onChange={(e) => set("imapUser", e.target.value)} data-testid="input-imap-user" /></div>
          <div><Label className="text-xs">Password (blank = SMTP)</Label><Input type="password" value={f.imapPass} onChange={(e) => set("imapPass", e.target.value)} data-testid="input-imap-pass" /></div>
          <div className="col-span-2 mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Limits and warm-up</div>
          <div><Label className="text-xs">Daily limit</Label><Input type="number" min={1} value={f.dailyLimit} onChange={num("dailyLimit")} data-testid="input-daily-limit" /></div>
          <label className="flex items-end gap-2 pb-2 text-sm"><Switch checked={f.warmupEnabled} onCheckedChange={(v) => set("warmupEnabled", v)} data-testid="switch-warmup" />Ramp up gradually</label>
          {f.warmupEnabled && <>
            <div><Label className="text-xs">Start at (emails/day)</Label><Input type="number" min={1} value={f.warmupStart} onChange={num("warmupStart")} data-testid="input-warmup-start" /></div>
            <div><Label className="text-xs">Add per day</Label><Input type="number" min={0} value={f.warmupIncrement} onChange={num("warmupIncrement")} data-testid="input-warmup-increment" /></div>
          </>}
        </div>
        <DialogFooter><Button disabled={!valid || pending} onClick={save} data-testid="button-save-mailbox">{pending ? "Saving..." : "Save mailbox"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
