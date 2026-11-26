import { useEffect, useState } from "react";
import { Clock, ShieldAlert, Sparkles, Target } from "lucide-react";
import { useGetSettings, useUpdateSettings, useInboundWebhook } from "@workspace/api-client-react";
import type { Settings } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { PageHeader, Panel, Rows, ErrorBox, TONE_OPTIONS, useRefreshAll } from "@/components/bits";
import { MailboxesPanel } from "@/components/settings/mailboxes";
import { LinkedinPanel, VoicePanel, WebhooksPanel, type IntegrationForm } from "@/components/settings/integrations";
import { CURRENCIES } from "@/components/crm/format";

type Form = Required<Omit<Settings, "unipileConnected" | "voiceConnected">> & { unipileApiKey: string; voiceApiKey: string };

const TIMEZONES = (() => {
  try { return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone"); } catch { return ["UTC"]; }
})();

const EMPTY: Form = {
  senderName: "", companyName: "", signature: "", defaultTone: "friendly", globalAutoReply: true, escalateNegative: true,
  icpDescription: "", publicBaseUrl: "", trackOpens: true, unsubscribeFooter: true, sendWindowStart: 8, sendWindowEnd: 18, sendWeekdaysOnly: true, timezone: "UTC",
  unipileDsn: "", unipileApiKey: "", unipileAccountId: "", linkedinDailyLimit: 25, voiceApiBaseUrl: "https://api.vapi.ai", voiceApiKey: "", voicePhoneNumberId: "", voiceName: "", currency: "USD",
};

export default function SettingsPage() {
  const q = useGetSettings();
  const upd = useUpdateSettings();
  const hook = useInboundWebhook();
  const refresh = useRefreshAll();
  const { toast } = useToast();
  const [f, setF] = useState<Form>(EMPTY);
  const [testEmail, setTestEmail] = useState("");
  useEffect(() => {
    if (!q.data) return;
    const { unipileConnected: _u, voiceConnected: _v, ...rest } = q.data;
    setF((p) => ({ ...p, ...rest, publicBaseUrl: rest.publicBaseUrl || window.location.origin, unipileApiKey: "", voiceApiKey: "" }));
  }, [q.data]);
  const set = (k: keyof Form, v: string | boolean | number) => setF((p) => ({ ...p, [k]: v }));
  const base = (f.publicBaseUrl || window.location.origin).replace(/\/+$/, "");
  const hours = Array.from({ length: 25 }, (_, i) => i);

  return (
    <div>
      <PageHeader eyebrow="Configuration" title="Settings">
        <Button disabled={upd.isPending || !q.data} data-testid="button-save-settings"
          onClick={() => upd.mutate({ data: f }, { onSuccess: () => { refresh(); setF((p) => ({ ...p, unipileApiKey: "", voiceApiKey: "" })); toast({ title: "Settings saved" }); }, onError: () => toast({ title: "Could not save settings", variant: "destructive" }) })}>{upd.isPending ? "Saving..." : "Save changes"}</Button>
      </PageHeader>
      {q.isLoading ? <div className="p-8"><Rows n={5} h={60} /></div> : q.isError ? <ErrorBox onRetry={() => q.refetch()} /> : (
        <div className="grid gap-5 p-6 md:p-8 xl:grid-cols-2">
          <div className="min-w-0 space-y-5">
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
            <Panel title="Sender identity" delay={40}>
              <div className="grid gap-3 p-4">
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs">Sender name</Label><Input value={f.senderName} onChange={(e) => set("senderName", e.target.value)} data-testid="input-sender-name" /></div>
                  <div><Label className="text-xs">Company</Label><Input value={f.companyName} onChange={(e) => set("companyName", e.target.value)} data-testid="input-company-name" /></div>
                </div>
                <div><Label className="text-xs">CRM currency (deal amounts and reports)</Label>
                  <select className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm" value={f.currency} onChange={(e) => set("currency", e.target.value)} data-testid="select-currency">
                    {Array.from(new Set([...CURRENCIES, f.currency])).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select></div>
                <div><Label className="text-xs">Default tone</Label>
                  <div className="mt-1 flex flex-wrap gap-1.5">{Array.from(new Set([...TONE_OPTIONS, f.defaultTone])).map((t) => (
                    <button key={t} onClick={() => set("defaultTone", t)} data-testid={`button-tone-${t}`}
                      className={`rounded-full border px-3 py-1 text-xs capitalize ${f.defaultTone === t ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-foreground"}`}>{t}</button>))}</div></div>
                <div><Label className="text-xs">Signature</Label><Textarea rows={4} value={f.signature} onChange={(e) => set("signature", e.target.value)} data-testid="input-signature" /></div>
              </div>
            </Panel>
            <Panel title="Ideal customer profile" delay={80}>
              <div className="grid gap-2 p-4">
                <div className="flex items-start gap-3 text-sm text-muted-foreground"><Target className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <p>Describe who you sell to. The AI scores every lead 0-100 against it from the Leads page.</p></div>
                <Textarea rows={4} value={f.icpDescription} onChange={(e) => set("icpDescription", e.target.value)} placeholder="VP or Head of Operations at logistics or freight companies with 50-500 employees in North America..." data-testid="input-icp" />
              </div>
            </Panel>
            <Panel title="Sending schedule and compliance" delay={120}>
              <div className="grid gap-3 p-4">
                <div className="flex items-start gap-3 text-sm text-muted-foreground"><Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <p>Automated sequence steps only go out inside this window. Manual sends and replies are not restricted.</p></div>
                <div className="grid grid-cols-3 gap-2">
                  <div><Label className="text-xs">From</Label><select className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm" value={f.sendWindowStart} onChange={(e) => set("sendWindowStart", Number(e.target.value))} data-testid="select-window-start">
                    {hours.slice(0, 24).map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</select></div>
                  <div><Label className="text-xs">Until</Label><select className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm" value={f.sendWindowEnd} onChange={(e) => set("sendWindowEnd", Number(e.target.value))} data-testid="select-window-end">
                    {hours.slice(1).map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</select></div>
                  <div><Label className="text-xs">Time zone</Label><select className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm" value={f.timezone} onChange={(e) => set("timezone", e.target.value)} data-testid="select-timezone">
                    {Array.from(new Set(["UTC", f.timezone, ...TIMEZONES])).map((t) => <option key={t}>{t}</option>)}</select></div>
                </div>
                <label className="flex items-center justify-between text-sm"><span>Weekdays only</span><Switch checked={f.sendWeekdaysOnly} onCheckedChange={(v) => set("sendWeekdaysOnly", v)} data-testid="switch-weekdays" /></label>
                <label className="flex items-center justify-between text-sm"><span>Track email opens</span><Switch checked={f.trackOpens} onCheckedChange={(v) => set("trackOpens", v)} data-testid="switch-track-opens" /></label>
                <label className="flex items-center justify-between text-sm"><span>Add unsubscribe link to emails</span><Switch checked={f.unsubscribeFooter} onCheckedChange={(v) => set("unsubscribeFooter", v)} data-testid="switch-unsubscribe" /></label>
                <div><Label className="text-xs">Public app URL (for tracking, unsubscribe links and webhooks)</Label>
                  <Input value={f.publicBaseUrl} onChange={(e) => set("publicBaseUrl", e.target.value)} data-testid="input-public-url" /></div>
              </div>
            </Panel>
          </div>
          <div className="min-w-0 space-y-5">
            <MailboxesPanel delay={60} />
            <LinkedinPanel f={f as IntegrationForm} set={set} connected={q.data?.unipileConnected} delay={100} />
            <VoicePanel f={f as IntegrationForm} set={set} connected={q.data?.voiceConnected} delay={140} />
            <WebhooksPanel base={base} delay={180} />
            <Panel title="Test the reply loop" delay={220}>
              <div className="space-y-2 p-4 text-sm">
                <p className="text-muted-foreground">Sends a fake reply from an existing lead through the generic webhook. The AI classifies it and replies or flags it.</p>
                <div className="flex gap-2">
                  <Input placeholder="Existing lead email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} data-testid="input-webhook-test-email" />
                  <Button variant="outline" disabled={!testEmail || hook.isPending} data-testid="button-test-webhook"
                    onClick={() => hook.mutate({ data: { channel: "email", fromEmail: testEmail, subject: "Re: intro", body: "Thanks for reaching out. Could you share a bit more about pricing?" } },
                      { onSuccess: () => { refresh(); toast({ title: "Webhook received", description: "Check the inbox." }); }, onError: () => toast({ title: "No lead matched that email", variant: "destructive" }) })}>
                    {hook.isPending ? "Sending..." : "Send test"}
                  </Button>
                </div>
              </div>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
