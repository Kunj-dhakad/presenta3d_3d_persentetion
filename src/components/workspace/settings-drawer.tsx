"use client";

import { AudioLines, Contact, FileText, Info, Palette, Stamp, Star, ThumbsUp } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { BrandingSection, DesignGate, TemplateSection, ThankYouSection, useDesignSettings, type DesignState } from "./design-settings";
// AvatarSection (and UserRound) are not imported while the presenter avatar is switched off (see below).
import { FeedbackSection, LeadSection, PresenterGate, SummarySection, usePresenterSettings, VoiceSection } from "./presenter-settings";
import { IconTile, StatePill } from "./settings-parts";

type Tone = React.ComponentProps<typeof IconTile>["tone"];

function Section({ value, icon, tone, title, on, children }: { value: string; icon: React.ReactNode; tone: Tone; title: string; on?: boolean; children: React.ReactNode }) {
  return (
    <AccordionItem value={value}>
      <AccordionTrigger>
        <IconTile tone={tone}>{icon}</IconTile>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <StatePill on={on} />
      </AccordionTrigger>
      <AccordionContent>{children}</AccordionContent>
    </AccordionItem>
  );
}

/** Design sections need a finished deck; until then they say why they are empty. */
function DesignPart({ d, ready, children }: { d: DesignState; ready: boolean; children: React.ComponentProps<typeof DesignGate>["children"] }) {
  if (!ready)
    return (
      <p className="mt-2 flex items-start gap-2 rounded-[10px] bg-brand-soft px-3 py-2.5 text-[12.5px] text-foreground/80">
        <Info className="mt-0.5 size-3.5 shrink-0 text-brand" /> Available when the presentation has finished generating.
      </p>
    );
  return <DesignGate d={d}>{children}</DesignGate>;
}

/**
 * Presentation settings in one right-side drawer: the deck's design
 * (template, colours, Thank-you slide, footer branding, auto-play; saved to the deck
 * and rebuilt) and the presenter (voice-over and its welcome text,
 * captions, lead form, feedback; saved in the PHP app).
 */
export function SettingsDrawer({ projectId, open, onOpenChange, designReady, onSaved }: { projectId: string; open: boolean; onOpenChange: (o: boolean) => void; designReady: boolean; onSaved: () => void }) {
  const d = useDesignSettings(projectId, open && designReady, onSaved);
  const p = usePresenterSettings(projectId, open);
  const deck = designReady ? d.settings : null;
  const form = p.form;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby="settings-drawer-desc">
        <SheetHeader className="border-b border-border">
          <SheetTitle>Presentation settings</SheetTitle>
          <SheetDescription id="settings-drawer-desc">Design rebuilds the preview; the presenter applies at once in Present and on the public link.</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto bg-surface px-4 py-3.5 thin-scroll">
          <Accordion type="single" collapsible defaultValue="template" className="grid gap-2.5">
            <Section value="template" icon={<Palette />} tone="blue" title="Template & colours">
              <DesignPart d={d} ready={designReady}>{(x) => <TemplateSection d={x} />}</DesignPart>
            </Section>
            {/* The presenter avatar is switched off: the talking avatar now belongs to the presentation's
                AI Agent (PHP: Agent → Avatar & voice), which greets viewers and speaks in the chat.
                The section stays in presenter-settings.tsx (AvatarSection) to bring it back:
            <Section value="avatar" icon={<UserRound />} tone="rose" title="AI avatar" on={form?.avatar}>
              <PresenterGate p={p}>{(x) => <AvatarSection p={x} />}</PresenterGate>
            </Section>
            */}
            <Section value="voice" icon={<AudioLines />} tone="amber" title="Voice-over & captions" on={form ? form.narration || form.subtitles : undefined}>
              <PresenterGate p={p}>{(x) => <VoiceSection p={x} />}</PresenterGate>
            </Section>
            {/* Auto-play is on by default (defaultDeckSettings) and the viewer's Auto control switches it;
                the section stays in design-settings.tsx (AutoplaySection) should it be wanted here again:
            <Section value="autoplay" icon={<Play />} tone="cyan" title="Auto-play" on={deck?.autoplay.enabled}>
              <DesignPart d={d} ready={designReady}>{(x) => <AutoplaySection d={x} />}</DesignPart>
            </Section>
            */}
            <Section value="thanks" icon={<ThumbsUp />} tone="coral" title="Thank-you slide" on={deck?.thankYou.enabled}>
              <DesignPart d={d} ready={designReady}>{(x) => <ThankYouSection d={x} />}</DesignPart>
            </Section>
            <Section value="brand" icon={<Stamp />} tone="slate" title="Footer branding" on={deck?.footer.enabled}>
              <DesignPart d={d} ready={designReady}>{(x) => <BrandingSection d={x} />}</DesignPart>
            </Section>
            <Section value="lead" icon={<Contact />} tone="blue" title="Lead form" on={form?.lead_form}>
              <PresenterGate p={p}>{(x) => <LeadSection p={x} />}</PresenterGate>
            </Section>
            <Section value="feedback" icon={<Star />} tone="amber" title="Audience feedback" on={form?.feedback}>
              <PresenterGate p={p}>{(x) => <FeedbackSection p={x} />}</PresenterGate>
            </Section>
            <Section value="summary" icon={<FileText />} tone="green" title="AI summary report" on={form?.summary}>
              <PresenterGate p={p}>{(x) => <SummarySection p={x} />}</PresenterGate>
            </Section>
          </Accordion>
        </div>
      </SheetContent>
    </Sheet>
  );
}
