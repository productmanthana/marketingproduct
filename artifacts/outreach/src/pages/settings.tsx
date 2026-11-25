import { useEffect, useState } from "react";
import { Copy, Linkedin, Mail, Phone, ShieldAlert, Sparkles, Webhook } from "lucide-react";
import { useGetSettings, useUpdateSettings, useInboundWebhook } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { PageHeader, Panel, Rows, ErrorBox, TONE_OPTIONS, chColor, useRefreshAll } from "@/components/bits";

export default function SettingsPage() {
  const q = useGetSettings();
  const upd = useUpdateSettings();
  const hook = useInboundWebhook();
  const refresh = useRefreshAll();
  const { toast } = useToast();
  const [f, setF] = useState({ senderName: "", companyName: "", signature: "", defaultTone: "friendly", globalAutoReply: true, escalateNegative: true });
  const [testEmail, setTestEmail] = useState("");
  useEffect(() => { if (q.data) setF({ ...q.data, escalateNegative: q.data.escalateNegative ?? true }); }, [q.data]);
  const url = `${window.location.origin}/api/webhooks/inbound`;
  const set = (k: keyof typeof f, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  return (
    <div>
      <PageHeader eyebrow="Configuration" title="Settings">
        <Button disabled={upd.isPending || !q.data} data-testid="button-save-settings"
          onClick={() => upd.mutate({ data: f }, { onSuccess: () => { refresh(); toast({ title: "Settings saved" }); } })}>{upd.isPending ? "Saving..." : "Save changes"}</Button>
      </PageHeader>
      <div className="grid gap-5 p-6 md:p-8 xl:grid-cols-2">
        {q.isLoading ? <Rows n={5} h={60} /> : q.isError ? <ErrorBox onRetry={() => q.refetch()} /> : (
          <div className="space-y-5">
            <Panel title="Autopilot">
              <div className="divide-y divide-border">
                <label className="flex items-center gap-4 p-4">
                  <Sparkles className="h-5 w-5 text-primary" />
                  <span className="flex-1"><b className="font-display text-lg">Global auto-reply</b><span className="block text-sm text-muted-foreground">Master switch. When off, no campaign replies on its own.</span></span>
                  <Switch checked={f.globalAutoReply} onCheckedChange={(v) => set("globalAutoReply", v)} data-testid="switch-global-autoreply" />
                </label>
                <label className="flex items-center gap-4 p-4">
                  <ShieldAlert className="h-5 w-5 text-destructive" />
                  <span className="flex-1"><b>Escalate negative replies</b><span className="block text-sm text-muted-foreground">Objections and negative sentiment go to human review instead of an AI answer.</span></span>
                  <Switch checked={f.escalateNegative} onCheckedChange={(v) => set("escalateNegative", v)} data-testid="switch-escalate" />
                </label>
              </div>
            </Panel>
            <Panel title="Sender identity" delay={60}>
              <div className="grid gap-3 p-4">
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs">Sender name</Label><Input value={f.senderName} onChange={(e) => set("senderName", e.target.value)} data-testid="input-sender-name" /></div>
                  <div><Label className="text-xs">Company</Label><Input value={f.companyName} onChange={(e) => set("companyName", e.target.value)} data-testid="input-company-name" /></div>
                </div>
                <div><Label className="text-xs">Default tone</Label>
                  <div className="mt-1 flex flex-wrap gap-1.5">{Array.from(new Set([...TONE_OPTIONS, f.defaultTone])).map((t) => (
                    <button key={t} onClick={() => set("defaultTone", t)} data-testid={`button-tone-${t}`}
                      className={`rounded-full border px-3 py-1 text-xs capitalize ${f.defaultTone === t ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-foreground"}`}>{t}</button>))}</div></div>
                <div><Label className="text-xs">Signature</Label><Textarea rows={4} value={f.signature} onChange={(e) => set("signature", e.target.value)} data-testid="input-signature" /></div>
              </div>
            </Panel>
          </div>
        )}
        <div className="space-y-5">
          <Panel title="Inbound webhook" delay={100}>
            <div className="space-y-3 p-4 text-sm">
              <p className="text-muted-foreground">Point any provider at this endpoint. Replies are matched to the lead and the AI takes it from there.</p>
              <div className="flex items-center gap-2 rounded-lg bg-foreground px-3 py-2.5 font-mono text-xs text-background">
                <Webhook className="h-3.5 w-3.5 text-primary" /><span className="opacity-60">POST</span><span className="flex-1 truncate" data-testid="text-webhook-url">{url}</span>
                <button onClick={() => { navigator.clipboard.writeText(url); toast({ title: "Copied" }); }} data-testid="button-copy-webhook"><Copy className="h-3.5 w-3.5" /></button>
              </div>
              <pre className="overflow-x-auto rounded-lg border border-border bg-muted/50 p-3 font-mono text-[11px] leading-relaxed">{`{
  "channel": "email" | "linkedin" | "call",
  "fromEmail": "lead@company.com",       // or
  "fromLinkedinUrl": "linkedin.com/in/...", // or
  "fromPhone": "+14155550142",
  "subject": "Re: quick question",
  "body": "Sounds interesting, what does pricing look like?"
}`}</pre>
              <div className="flex gap-2">
                <Input placeholder="Existing lead email to test" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} data-testid="input-webhook-test-email" />
                <Button variant="outline" disabled={!testEmail || hook.isPending} data-testid="button-test-webhook"
                  onClick={() => hook.mutate({ data: { channel: "email", fromEmail: testEmail, subject: "Re: intro", body: "Thanks for reaching out. Could you share a bit more about pricing?" } },
                    { onSuccess: () => { refresh(); toast({ title: "Webhook received", description: "Check the inbox." }); }, onError: () => toast({ title: "No lead matched that email", variant: "destructive" }) })}>
                  {hook.isPending ? "Sending..." : "Send test"}
                </Button>
              </div>
            </div>
          </Panel>
          <Panel title="Connections" delay={140}>
            <div className="divide-y divide-border">
              {([["Gmail / Outlook", "Send from your real mailbox and sync replies", Mail, "email"], ["LinkedIn", "Connection requests and DMs", Linkedin, "linkedin"], ["Phone (Twilio)", "Click-to-dial and call recording", Phone, "call"]] as const).map(([n, d, I, ch]) => (
                <div key={n} className="flex items-center gap-3 p-4">
                  <div className="grid h-9 w-9 place-items-center rounded-lg" style={{ background: chColor(ch, 0.12), color: chColor(ch) }}><I className="h-4 w-4" /></div>
                  <div className="flex-1"><div className="text-sm font-medium">{n}</div><div className="text-xs text-muted-foreground">{d}</div></div>
                  <span className="rounded-full border border-dashed border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Coming next</span>
                  <Button size="sm" variant="outline" disabled data-testid={`button-connect-${ch}`}>Connect</Button>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
