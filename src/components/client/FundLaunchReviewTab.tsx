import { Rocket, MousePointerClick, ClipboardCheck, Globe, CalendarCheck, MailPlus, Bot, PartyPopper, PhoneCall, LineChart, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AdRotatorMockup, type AdPlatform } from '@/components/funnel/AdRotatorMockup';
import { useFunnelSteps } from '@/hooks/useFunnelSteps';
import { useFunnelStepAds } from '@/hooks/useFunnelStepAds';
import { useCreatives } from '@/hooks/useCreatives';
import csiForm1 from '@/assets/csi_form_1.png.asset.json';
import csiForm2 from '@/assets/csi_form_2.png.asset.json';
import csiForm3 from '@/assets/csi_form_3.png.asset.json';
import csiForm4 from '@/assets/csi_form_4.png.asset.json';
import csiForm5 from '@/assets/csi_form_5.png.asset.json';

interface FundLaunchReviewTabProps {
  clientId: string;
  clientName: string;
}

const Placeholder = ({ label }: { label: string }) => (
  <div className="border-2 border-dashed border-border rounded-lg bg-muted/30 px-4 py-8 text-center text-xs text-muted-foreground">
    {label}
  </div>
);

const LinkCard = ({ label, href }: { label: string; href: string }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="block rounded-lg border border-border bg-muted/30 px-4 py-4 hover:bg-muted/60 hover:border-primary/60 transition-colors"
  >
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
    <div className="text-sm text-primary font-medium mt-1 break-all">{href}</div>
  </a>
);

const Step = ({
  number,
  icon: Icon,
  title,
  children,
}: {
  number: number;
  icon: any;
  title: string;
  children: React.ReactNode;
}) => (
  <Card className="overflow-hidden border-border/60">
    <CardHeader className="bg-muted/40 border-b border-border/60">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm shrink-0">
          {number}
        </div>
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg font-display tracking-tight">{title}</CardTitle>
        </div>
      </div>
    </CardHeader>
    <CardContent className="pt-6 space-y-4 text-sm leading-relaxed text-foreground/90">
      {children}
    </CardContent>
  </Card>
);

const SubHeading = ({ children }: { children: React.ReactNode }) => (
  <h4 className="font-semibold text-foreground mt-4 mb-1">{children}</h4>
);

export default function FundLaunchReviewTab({ clientId, clientName }: FundLaunchReviewTabProps) {
  // Pull the same ad creatives shown in the Funnel tab's ads step.
  const { data: steps = [] } = useFunnelSteps(clientId);
  const adsStep = steps.find(s => s.step_kind === 'ads');
  const { data: stepAds = [] } = useFunnelStepAds(adsStep ? [adsStep.id] : []);
  const { data: allCreatives = [] } = useCreatives(adsStep ? clientId : undefined);
  const selectedAdCreatives = stepAds
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(a => allCreatives.find(c => c.id === a.creative_id))
    .filter(Boolean) as typeof allCreatives;
  const adPlatform: AdPlatform = (adsStep?.ad_platform as AdPlatform) || 'facebook';

  const formShots = [
    { src: csiForm1.url, label: 'Qualification' },
    { src: csiForm2.url, label: 'Contact Info' },
    { src: csiForm3.url, label: 'Phone Verification' },
    { src: csiForm4.url, label: 'Qualified — Next Step' },
    { src: csiForm5.url, label: 'Not-a-Fit End Screen' },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-16">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-background to-background p-8">
        <div className="flex items-center gap-2 mb-3">
          <Rocket className="h-5 w-5 text-primary" />
          <Badge variant="secondary" className="uppercase tracking-wider text-[10px]">Launch Review</Badge>
        </div>
        <h1 className="text-3xl md:text-4xl font-display font-bold tracking-tight">{clientName}</h1>
        <p className="text-xl text-muted-foreground mt-1">Investor Journey &amp; Launch Review</p>
        <p className="mt-5 max-w-3xl text-sm leading-relaxed text-foreground/80">
          This document provides a walkthrough of the investor experience for the {clientName} campaign — from the first
          interaction with an advertisement through qualification, follow-up, scheduling an Investor Call, and ongoing
          investor communication. The goal is to provide visibility into the final investor-facing assets, messaging,
          and communication flow prior to launch.
        </p>
      </div>

      {/* 1. Advertising */}
      <Step number={1} icon={MousePointerClick} title="Advertising">
        <p>The investor journey begins with advertisements running across Facebook and Instagram.</p>
        <p>Prospective investors will see {clientName} ads designed to introduce the offering and encourage qualified investors to learn more.</p>
        <p>Investors who are interested can click the ad to begin the qualification process.</p>
        <SubHeading>Final Ads</SubHeading>
        <div className="flex flex-col items-center gap-4 pt-2">
          {selectedAdCreatives.length > 0 ? (
            <AdRotatorMockup
              creatives={selectedAdCreatives}
              platform={adPlatform}
              deviceType="phone"
              brandName={clientName}
            />
          ) : (
            <Placeholder label="Select ads in the Funnel tab's Ads step to see the live preview here." />
          )}
          <p className="text-xs text-muted-foreground text-center max-w-md">
            Live rotating preview of the approved {clientName} ads — pulled from the Funnel tab's Ads step.
          </p>
        </div>
      </Step>

      {/* 2. Qualification */}
      <Step number={2} icon={ClipboardCheck} title="Investor Qualification">
        <p>After clicking an advertisement, the investor is taken to a Meta Lead Form used to qualify prospective investors before directing them to the next step.</p>
        <SubHeading>Accreditation Status</SubHeading>
        <p>The investor is asked whether they are an accredited investor. {clientName} will still capture investors who indicate that they are not accredited, but campaign optimization will focus on accredited investors.</p>
        <SubHeading>Available Liquidity</SubHeading>
        <p>The investor is asked about their current available liquidity. Investors who indicate less than $100,000 are directed to a separate end screen and their contact information is not collected.</p>
        <SubHeading>Contact Information &amp; Phone Verification</SubHeading>
        <p>Qualified investors provide their name, email, and phone number. Phone verification is required before the form can be submitted — this reduces spam, bot submissions, and inaccurate contact information.</p>
        <SubHeading>Qualified Investor Next Step</SubHeading>
        <p>Qualified investors are prompted to continue to the {clientName} landing page to learn more and schedule an Investor Call.</p>
        <SubHeading>Final Lead Form</SubHeading>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-2">
          {formShots.map((s) => (
            <figure key={s.label} className="space-y-1.5">
              <div className="rounded-xl overflow-hidden border border-border bg-muted/30 shadow-sm">
                <img src={s.src} alt={`${clientName} Meta lead form — ${s.label}`} className="w-full h-auto block" loading="lazy" />
              </div>
              <figcaption className="text-[10px] text-center text-muted-foreground font-medium uppercase tracking-wider">{s.label}</figcaption>
            </figure>
          ))}
        </div>
      </Step>

      {/* 3. Landing Page */}
      <Step number={3} icon={Globe} title="Investor Landing Page">
        <p>After completing the Meta Lead Form, qualified investors are directed to the {clientName} landing page. The landing page gives the investor an opportunity to learn more about the fund before scheduling a call.</p>
        <p>Investors can review the offering, watch the Investor Video, learn about the three investment paths, and schedule an Investor Call.</p>
        <p>From this point, the investor can take one of two paths.</p>
        <SubHeading>Final Landing Page</SubHeading>
        <LinkCard label="Landing Page (with Calendar)" href="https://clearsummitinvestment.com/book-a-call" />
      </Step>

      {/* 4. Books a Call */}
      <Step number={4} icon={CalendarCheck} title="Investor Books a Call">
        <p>If the investor schedules an Investor Call, they are removed from the pre-booking email and SMS nurture sequences and enter the booked-call confirmation and reminder sequence.</p>
        <p>The investor receives:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>Immediate booking confirmation email and SMS.</li>
          <li>24-hour reminder email and SMS.</li>
          <li>1-hour reminder email and SMS.</li>
        </ul>
        <p>Each communication provides the investor with their call details and easy access to the meeting link. The confirmation and reminder emails also help prepare the investor for the upcoming conversation and provide access to the Investor Deck before the call.</p>
        <SubHeading>Final Booked-Call Communications</SubHeading>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Placeholder label="[ Confirmation Email ]" />
          <Placeholder label="[ Confirmation SMS ]" />
          <Placeholder label="[ 24-Hour Email ]" />
          <Placeholder label="[ 24-Hour SMS ]" />
          <Placeholder label="[ 1-Hour Email ]" />
          <Placeholder label="[ 1-Hour SMS ]" />
        </div>
      </Step>

      {/* 5. Does not book */}
      <Step number={5} icon={MailPlus} title="Investor Does Not Book a Call">
        <p>If the investor completes the Meta Lead Form but does not schedule an Investor Call, they enter the pre-booking nurture process.</p>
        <p>The investor receives a series of emails and text messages designed to provide additional information, continue the conversation, and encourage them to schedule a call. {clientName}'s setter can also follow up directly with new leads by phone.</p>
        <p>If the investor schedules a call at any point, they are automatically removed from the pre-booking nurture sequences and enter the booked-call communication flow.</p>
        <SubHeading>Final Email &amp; SMS Nurture Communications</SubHeading>
        <LinkCard
          label="Nurture Copy — Email & SMS Doc"
          href="https://docs.google.com/document/d/1w4b6FWmxb2RNfEKZRne3CpclQt7BUJjl7hBbrtzqKio/edit?tab=t.816aurpkg581"
        />
      </Step>

      {/* 6. AI Setter */}
      <Step number={6} icon={Bot} title="AI Setter">
        <p>If an investor responds to a pre-booking email or text message, they are removed from the automated nurture sequence and the AI Setter begins the conversation.</p>
        <p>The AI Setter is designed to continue the conversation, answer basic questions about the offering, and guide the investor toward scheduling an Investor Call. It can provide approved information about the fund and direct investors to available resources.</p>
        <p>The AI Setter does not provide investment advice, tax advice, recommend how much an investor should invest, guarantee returns, or make claims outside of the approved offering information. The {clientName} team can monitor conversations and step in manually when needed.</p>
        <SubHeading>Preview the AI Setter</SubHeading>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Placeholder label="[ AI Setter Preview Link ]" />
          <Placeholder label="[ Example Conversation Screenshot ]" />
        </div>
      </Step>

      {/* 7. Thank You */}
      <Step number={7} icon={PartyPopper} title="Thank You Page">
        <p>After scheduling an Investor Call, the investor is directed to the {clientName} Thank You Page. The page confirms that the call has been scheduled and provides additional resources the investor can review before the conversation.</p>
        <p>The Thank You Page includes:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>Investor FAQ videos.</li>
          <li>Frequently asked questions.</li>
          <li>Information about the {clientName} resort portfolio.</li>
          <li>Access to the Investor Deck.</li>
        </ul>
        <SubHeading>Final Thank You Page</SubHeading>
        <LinkCard label="Thank You Page" href="https://clearsummitinvestment.com/thank-you" />
        <SubHeading>Investor Deck</SubHeading>
        <Placeholder label="[ Investor Deck Preview Link ]" />
      </Step>

      {/* 8. Call & Follow Up */}
      <Step number={8} icon={PhoneCall} title="Investor Call & Follow-Up Process">
        <p>Once the Investor Call takes place, the investor moves into the post-call follow-up process based on the outcome of the conversation. Investors may move through the following stages:</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
          {[
            ['Interested — Follow-Up', 'The investor has expressed interest but requires additional follow-up before taking the next step.'],
            ['Due Diligence / Reviewing Materials', 'The investor is actively reviewing offering materials, discussing the opportunity with a spouse or advisor, or completing additional due diligence.'],
            ['Reconnect Call Booked', 'The investor has scheduled another conversation with the team.'],
            ['Soft Committed', 'The investor has indicated their intent to invest.'],
            ['Subscribed', 'The investor has completed the subscription process.'],
            ['Funded', "The investor's investment has been funded."],
          ].map(([title, desc]) => (
            <div key={title} className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <div className="font-semibold text-sm text-foreground">{title}</div>
              <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{desc}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground italic mt-3">The pipeline may continue to be refined based on investor behavior and common outcomes identified after launch.</p>
      </Step>

      {/* 9. Tracking */}
      <Step number={9} icon={LineChart} title="Tracking & Reporting">
        <p>Investor activity is tracked throughout the campaign to provide visibility into both marketing performance and investor progression. The campaign scorecard tracks:</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
          {[
            'Ad Spend', 'Leads Generated', 'Cost Per Lead',
            'Investor Calls Booked', 'Cost Per Booked Call', 'Discovery Call Outcomes',
            'Show Rate / No-Show Rate', 'Reconnect Calls', 'Soft Commitments',
            'Subscribed Investors', 'Funded Investors',
          ].map((m) => (
            <div key={m} className="rounded-md border border-border/60 bg-background px-3 py-2 text-xs font-medium text-foreground/90">
              {m}
            </div>
          ))}
        </div>
        <p className="mt-3">Meta provides advertising performance data, while investor activity, booked calls, call outcomes, and investment progression are tracked through HubSpot and the connected systems.</p>
      </Step>

      {/* 10. Final Review */}
      <Step number={10} icon={CheckCircle2} title="Final Review">
        <p>Please review the investor journey and final assets included in this document. The primary items for review are:</p>
        <ul className="space-y-1.5 mt-2">
          {[
            'Final advertisements.',
            'Meta Lead Form and qualification process.',
            'Investor Landing Page.',
            'Thank You Page.',
            'Pre-booking email and SMS communications.',
            'Booked-call confirmation and reminder communications.',
            'AI Setter experience.',
            'Investor follow-up process.',
          ].map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm">
              <div className="mt-0.5 h-4 w-4 rounded border border-border shrink-0" />
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <SubHeading>Final Feedback / Requested Changes</SubHeading>
        <Placeholder label="[ Comments or Feedback ]" />

        <SubHeading>Launch Approval</SubHeading>
        <div className="space-y-2 mt-1">
          {['Approved for Launch', 'Approved with Changes', 'Additional Revisions Required'].map((opt) => (
            <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" className="h-4 w-4 rounded border-border" />
              <span>{opt}</span>
            </label>
          ))}
        </div>
      </Step>
    </div>
  );
}
