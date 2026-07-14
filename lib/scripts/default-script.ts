export const STARTER_SCRIPT_NAME = "WolfGrid Sales Call Flow";
export const STARTER_SCRIPT_ID = "starter-flyr-sales-call-flow";
export const REAL_ESTATE_QUICK_DEMO_SCRIPT_NAME =
  "Real Estate Teams - quick demo";
export const REAL_ESTATE_QUICK_DEMO_SCRIPT_ID = "real-estate-teams-quick-demo";
export const REAL_ESTATE_INDIVIDUAL_AGENT_SCRIPT_NAME =
  "Real Estate Individual Agents - listing appointments";
export const REAL_ESTATE_INDIVIDUAL_AGENT_SCRIPT_ID =
  "real-estate-individual-agents-listing-appointments";
export const INDIVIDUAL_REALTOR_LISTING_LEVERAGE_SCRIPT_NAME =
  "Individual Realtors - listing leverage campaign";
export const INDIVIDUAL_REALTOR_LISTING_LEVERAGE_SCRIPT_ID =
  "individual-realtors-listing-leverage-trial";
export const INDIVIDUAL_REALTOR_LISTING_LEVERAGE_V2_SCRIPT_NAME =
  "Individual Realtors - listing leverage campaign V2";
export const INDIVIDUAL_REALTOR_LISTING_LEVERAGE_V2_SCRIPT_ID =
  "individual-realtors-listing-leverage-trial-v2";

export type StarterScriptFlowLine = {
  speaker: "rep" | "person";
  text: string;
};

export type StarterScriptFlowNode = {
  id: string;
  label: string;
  kind: "start" | "question" | "objection" | "close" | "done";
  title: string;
  say: string;
  lines?: StarterScriptFlowLine[];
  coach?: string;
  options: Array<{
    label: string;
    nextId: string;
  }>;
};

const SCRIPT_FLOW_BODY_PREFIX = "__FLYR_SCRIPT_FLOW_V1__\n";

export function encodeScriptFlowBody(flow: StarterScriptFlowNode[]): string {
  return `${SCRIPT_FLOW_BODY_PREFIX}${JSON.stringify({ version: 1, flow })}`;
}

export function parseScriptFlowBody(
  body: string | null | undefined,
): StarterScriptFlowNode[] | null {
  if (!body?.startsWith(SCRIPT_FLOW_BODY_PREFIX)) return null;

  try {
    const payload = JSON.parse(body.slice(SCRIPT_FLOW_BODY_PREFIX.length)) as {
      version?: unknown;
      flow?: unknown;
    };
    if (payload.version !== 1 || !Array.isArray(payload.flow)) return null;

    const flow = payload.flow
      .map((node): StarterScriptFlowNode | null => {
        if (!node || typeof node !== "object") return null;
        const candidate = node as Partial<StarterScriptFlowNode>;
        if (
          typeof candidate.id !== "string" ||
          typeof candidate.label !== "string" ||
          typeof candidate.kind !== "string" ||
          typeof candidate.title !== "string" ||
          typeof candidate.say !== "string" ||
          !Array.isArray(candidate.options)
        ) {
          return null;
        }

        const kind = candidate.kind;
        if (!["start", "question", "objection", "close", "done"].includes(kind))
          return null;

        const options = candidate.options
          .map((option) => {
            if (!option || typeof option !== "object") return null;
            const candidateOption = option as {
              label?: unknown;
              nextId?: unknown;
            };
            if (
              typeof candidateOption.label !== "string" ||
              typeof candidateOption.nextId !== "string"
            ) {
              return null;
            }
            return {
              label: candidateOption.label,
              nextId: candidateOption.nextId,
            };
          })
          .filter(Boolean) as StarterScriptFlowNode["options"];

        const lines = Array.isArray(candidate.lines)
          ? (candidate.lines
              .map((line): StarterScriptFlowLine | null => {
                if (!line || typeof line !== "object") return null;
                const candidateLine = line as {
                  speaker?: unknown;
                  text?: unknown;
                };
                if (
                  (candidateLine.speaker !== "rep" &&
                    candidateLine.speaker !== "person") ||
                  typeof candidateLine.text !== "string"
                ) {
                  return null;
                }
                return {
                  speaker: candidateLine.speaker,
                  text: candidateLine.text,
                };
              })
              .filter(Boolean) as StarterScriptFlowLine[])
          : undefined;

        return {
          id: candidate.id,
          label: candidate.label,
          kind,
          title: candidate.title,
          say: candidate.say,
          lines: lines?.length ? lines : undefined,
          coach:
            typeof candidate.coach === "string" ? candidate.coach : undefined,
          options,
        };
      })
      .filter(Boolean) as StarterScriptFlowNode[];

    return flow.length > 0 ? flow : null;
  } catch {
    return null;
  }
}

const QUICK_DEMO_CLOSE_OPTIONS: StarterScriptFlowNode["options"] = [
  { label: "Show them demo", nextId: "demo-send" },
  { label: "Still not convinced", nextId: "fallback-not-convinced" },
  { label: "Asks price", nextId: "price-objection" },
];

export const STARTER_SCRIPT_FLOW: StarterScriptFlowNode[] = [
  {
    id: "start",
    label: "Start",
    kind: "start",
    title: "Open with permission",
    say: "Hey [Name], it's [Rep Name] with WolfGrid. Did I catch you with 30 seconds?",
    coach:
      "Keep the opener short. The first goal is permission, not a full pitch.",
    options: [
      { label: "Yes", nextId: "qualify-activity" },
      { label: "Busy", nextId: "busy" },
      { label: "Who's this?", nextId: "quick-intro" },
      { label: "Not interested", nextId: "not-interested" },
    ],
  },
  {
    id: "quick-intro",
    label: "Intro",
    kind: "objection",
    title: "Quick intro",
    say: "WolfGrid helps real estate team leads track door knocking, agent activity, and leads from the field.",
    coach:
      "Answer directly, then get back to a question. Do not list every feature.",
    options: [
      { label: "Ask activity question", nextId: "qualify-activity" },
      { label: "Ask to send demo", nextId: "demo-ask" },
    ],
  },
  {
    id: "busy",
    label: "Busy",
    kind: "objection",
    title: "If they are busy",
    say: "No worries. I will be quick. WolfGrid helps real estate team leads track door knocking, agent activity, and leads from the field. Would it be okay if I emailed you a 90-second demo?",
    coach:
      "Do not keep selling. Convert the call into permission to send the demo or a callback.",
    options: [
      { label: "Yes, send demo", nextId: "send-demo" },
      { label: "Call later", nextId: "call-later" },
      { label: "No", nextId: "graceful-close" },
    ],
  },
  {
    id: "not-interested",
    label: "No interest",
    kind: "objection",
    title: "If they say not interested",
    say: "Totally understand. Before I let you go, would it be okay if I sent the 90-second demo just so you can see the concept?",
    coach: "Lower the ask. Do not argue or explain every feature.",
    options: [
      { label: "Yes, send demo", nextId: "send-demo" },
      { label: "No", nextId: "graceful-close" },
    ],
  },
  {
    id: "qualify-activity",
    label: "Qualify",
    kind: "question",
    title: "Qualify team activity",
    say: "Perfect. Quick question: do you have agents on your team doing any door knocking, flyer drops, open house follow-up, or neighbourhood prospecting?",
    coach: "Question first, value second. Listen for active field prospecting.",
    options: [
      { label: "Yes", nextId: "current-tracking" },
      { label: "Sometimes", nextId: "current-tracking" },
      { label: "Not sure", nextId: "clarify-activity" },
      { label: "No", nextId: "no-field-activity" },
    ],
  },
  {
    id: "clarify-activity",
    label: "Clarify",
    kind: "question",
    title: "Clarify field work",
    say: "No problem. I mean things like farming a neighbourhood, canvassing around a listing or sale, dropping flyers, or following up after open houses. Does your team do any of that?",
    coach:
      "Use examples. Then route based on whether they have field activity.",
    options: [
      { label: "Yes or sometimes", nextId: "current-tracking" },
      { label: "No", nextId: "no-field-activity" },
      { label: "Ask to send demo", nextId: "demo-ask" },
    ],
  },
  {
    id: "current-tracking",
    label: "Tracking",
    kind: "question",
    title: "Find the tracking pain",
    say: "Got it. Are you currently tracking which doors were hit, which agents are active, and what leads came from the field?",
    coach:
      "This is the pain question. Do not pitch until you know the current system.",
    options: [
      { label: "Not really", nextId: "match-no-system" },
      { label: "It's manual", nextId: "match-no-system" },
      { label: "Yes, we track it", nextId: "match-existing-system" },
      { label: "We use another tool", nextId: "match-other-tool" },
    ],
  },
  {
    id: "match-no-system",
    label: "Pain match",
    kind: "question",
    title: "Manual or no tracking",
    say: "That's exactly why we built WolfGrid. It gives team leads a live map of agent activity, completed doors, territory coverage, leads, and follow-ups in one place.",
    coach: "Keep it simple. This is the strongest fit path.",
    options: [
      { label: "Ask to send demo", nextId: "demo-ask" },
      { label: "They ask pricing", nextId: "pricing" },
      { label: "They want a meeting", nextId: "book-demo" },
    ],
  },
  {
    id: "match-existing-system",
    label: "Existing",
    kind: "question",
    title: "They already track it",
    say: "Makes sense. Most teams have some kind of system. WolfGrid is built specifically for real estate field prospecting, so it is more visual and team-focused than spreadsheets or scattered notes.",
    coach:
      "Respect what they already have. Position WolfGrid as focused, visual, and team-based.",
    options: [
      { label: "Ask to send demo", nextId: "demo-ask" },
      { label: "They ask pricing", nextId: "pricing" },
      { label: "They use another tool", nextId: "match-other-tool" },
    ],
  },
  {
    id: "match-other-tool",
    label: "Other tool",
    kind: "question",
    title: "They use another tool",
    say: "Totally. A lot of tools are general canvassing platforms. WolfGrid is focused on real estate teams: territories, agent accountability, neighbourhood coverage, and lead follow-up.",
    coach:
      "Do not attack the other tool. Create contrast around real estate team workflows.",
    options: [
      { label: "Ask to send demo", nextId: "demo-ask" },
      { label: "They ask pricing", nextId: "pricing" },
      { label: "Book comparison demo", nextId: "book-demo" },
    ],
  },
  {
    id: "pricing",
    label: "Pricing",
    kind: "objection",
    title: "Answer pricing",
    say: "WolfGrid is currently available with early access pricing. Teams can start at $30 USD per user/month, which is about $40 CAD. If WolfGrid helps your team create even one extra deal, it more than pays for itself.",
    coach: "Answer clearly, then return to the demo ask.",
    options: [
      { label: "Ask to send demo", nextId: "demo-ask" },
      { label: "Book demo", nextId: "book-demo" },
      { label: "No", nextId: "graceful-close" },
    ],
  },
  {
    id: "demo-ask",
    label: "Demo ask",
    kind: "close",
    title: "Micro-close",
    say: "Would it be okay if I emailed you a 90-second demo? You'll know pretty quickly if it makes sense for your team.",
    coach: "This is the call goal. Qualify, send demo, then set the next step.",
    options: [
      { label: "Yes", nextId: "send-demo" },
      { label: "Email it", nextId: "email-demo" },
      { label: "Book a demo", nextId: "book-demo" },
      { label: "Call later", nextId: "call-later" },
      { label: "No", nextId: "graceful-close" },
    ],
  },
  {
    id: "send-demo",
    label: "Send demo",
    kind: "close",
    title: "Send the 90-second demo",
    say: "Perfect. What is the best email? I will send it now. If it looks useful, we can book 10 minutes and I will show you how it would work for your team.",
    coach: "Confirm the email, send immediately, then create the follow-up task before moving on.",
    options: [
      { label: "Email confirmed", nextId: "done" },
      { label: "Book follow-up", nextId: "book-demo" },
      { label: "Set callback", nextId: "call-later" },
    ],
  },
  {
    id: "email-demo",
    label: "Email demo",
    kind: "close",
    title: "Email the demo",
    say: "Of course. What is the best email? I will send the 90-second demo and keep it concise.",
    coach: "Confirm spelling and create the follow-up.",
    options: [
      { label: "Email captured", nextId: "done" },
      { label: "Book follow-up", nextId: "book-demo" },
    ],
  },
  {
    id: "book-demo",
    label: "Book demo",
    kind: "close",
    title: "Book the follow-up",
    say: "The easiest next step is 10 minutes where I can show you how WolfGrid would work for your team. Does [Time 1] or [Time 2] work better?",
    coach: "Offer two times. Keep the commitment small.",
    options: [
      { label: "Booked", nextId: "done" },
      { label: "Send demo first", nextId: "send-demo" },
      { label: "Call later", nextId: "call-later" },
    ],
  },
  {
    id: "call-later",
    label: "Call later",
    kind: "close",
    title: "Schedule callback",
    say: "No problem. I can call you back at [Time]. I will also send the short demo so you know what I am referring to.",
    coach:
      "Always leave with a next step: demo sent, callback set, or not interested.",
    options: [
      { label: "Callback set", nextId: "done" },
      { label: "Send demo only", nextId: "send-demo" },
    ],
  },
  {
    id: "no-field-activity",
    label: "No fit",
    kind: "close",
    title: "No field activity right now",
    say: "Got it. Sounds like this may not be a fit right now. If you ever add field prospecting, WolfGrid could help track it.",
    coach: "Do not force the pitch. Mark the outcome cleanly.",
    options: [
      { label: "Ask to send concept demo", nextId: "demo-ask" },
      { label: "Mark not a fit", nextId: "done" },
    ],
  },
  {
    id: "graceful-close",
    label: "Close",
    kind: "close",
    title: "End cleanly",
    say: "No problem at all. Appreciate your time.",
    coach: "Do not argue. Mark not interested and move on.",
    options: [{ label: "Done", nextId: "done" }],
  },
  {
    id: "done",
    label: "Done",
    kind: "done",
    title: "Call complete",
    say: "Log the outcome, add the follow-up, and move to the next call.",
    coach:
      "The call must end with a clear disposition: demo sent, follow-up booked, callback set, no fit, or not interested.",
    options: [{ label: "Start again", nextId: "start" }],
  },
];

export const STARTER_SCRIPT_BODY = `WolfGrid Sales Call Flow

START:
Hey [Name], it's [Rep Name] with WolfGrid. Did I catch you with 30 seconds?

QUALIFY:
Do you have agents on your team doing any door knocking, flyer drops, open house follow-up, or neighbourhood prospecting?

TRACKING QUESTION:
Are you currently tracking which doors were hit, which agents are active, and what leads came from the field?

PAIN MATCH:
If manual or not really:
That's exactly why we built WolfGrid. It gives team leads a live map of agent activity, completed doors, territory coverage, leads, and follow-ups in one place.

If they already track it:
Makes sense. Most teams have some kind of system. WolfGrid is built specifically for real estate field prospecting, so it is more visual and team-focused than spreadsheets or scattered notes.

If they use another tool:
Totally. A lot of tools are general canvassing platforms. WolfGrid is focused on real estate teams: territories, agent accountability, neighbourhood coverage, and lead follow-up.

MICRO-CLOSE:
Would it be okay if I emailed you a 90-second demo? You'll know pretty quickly if it makes sense for your team.

REP RULES:
1. Do not explain every feature.
2. The first call is only to qualify and send the demo.
3. Do not argue.
4. Question first, value second.
5. Always end with a next step: send demo, book follow-up, call later, or mark not interested.`;

export const REAL_ESTATE_INDIVIDUAL_AGENT_SCRIPT_FLOW: StarterScriptFlowNode[] = [
  {
    id: "opening",
    label: "Opening",
    kind: "start",
    title: "Founder opener",
    say: "Hey [Name], it's Daniel. Reason for the call today is I'm the founder of a software company called WolfGrid. We help Realtors get more listing appointments using more of an old-school approach.\n\nI'd love to share a little more about the company, but first, how's business treating you so far this year?",
    lines: [
      {
        speaker: "rep",
        text: "Hey [Name], it's Daniel. Reason for the call today is I'm the founder of a software company called WolfGrid. We help Realtors get more listing appointments using more of an old-school approach.\n\nI'd love to share a little more about the company, but first, how's business treating you so far this year?",
      },
    ],
    coach:
      "Lead with the founder angle, then ask about their business. The first goal is a real conversation, not a feature dump.",
    options: [
      { label: "Business is good", nextId: "current-lead-source" },
      { label: "Business is slow", nextId: "slow-business" },
      { label: "Busy", nextId: "busy" },
      { label: "Who's this?", nextId: "quick-intro" },
      { label: "Not interested", nextId: "not-interested" },
    ],
  },
  {
    id: "quick-intro",
    label: "Intro",
    kind: "objection",
    title: "Quick intro",
    say: "Totally. I'm Daniel, the founder of WolfGrid. We help individual Realtors create more seller conversations and turn those into listing appointments using an old-school, relationship-based prospecting approach.",
    lines: [
      {
        speaker: "rep",
        text: "Totally. I'm Daniel, the founder of WolfGrid. We help individual Realtors create more seller conversations and turn those into listing appointments using an old-school, relationship-based prospecting approach.",
      },
    ],
    coach:
      "Answer directly, then get back to the business question. Keep the tone curious.",
    options: [
      { label: "Ask business question", nextId: "opening" },
      { label: "Ask seller question", nextId: "seller-conversations" },
    ],
  },
  {
    id: "busy",
    label: "Busy",
    kind: "objection",
    title: "If they are busy",
    say: "No worries, I can be quick. WolfGrid helps Realtors create more listing appointments through a simple field-prospecting system. Before I let you go, are you currently looking for more seller conversations, or are you covered right now?",
    lines: [
      {
        speaker: "rep",
        text: "No worries, I can be quick. WolfGrid helps Realtors create more listing appointments through a simple field-prospecting system. Before I let you go, are you currently looking for more seller conversations, or are you covered right now?",
      },
    ],
    coach:
      "Respect the interruption. Ask one qualifying question, then either book a callback or move on.",
    options: [
      { label: "Needs sellers", nextId: "seller-conversations" },
      { label: "Covered", nextId: "covered-right-now" },
      { label: "Call later", nextId: "call-later" },
      { label: "No", nextId: "graceful-close" },
    ],
  },
  {
    id: "not-interested",
    label: "No interest",
    kind: "objection",
    title: "If they say not interested",
    say: "Totally fair. Just so I don't follow up with something irrelevant, are you not focused on growing listings right now, or do you already have that side covered?",
    lines: [
      {
        speaker: "rep",
        text: "Totally fair. Just so I don't follow up with something irrelevant, are you not focused on growing listings right now, or do you already have that side covered?",
      },
    ],
    coach:
      "Do not argue. Try to learn whether the issue is timing, listings, or WolfGrid specifically.",
    options: [
      { label: "Not growing listings", nextId: "not-growing-listings" },
      { label: "Already covered", nextId: "covered-right-now" },
      { label: "No answer", nextId: "graceful-close" },
    ],
  },
  {
    id: "slow-business",
    label: "Slow",
    kind: "question",
    title: "Business is slow",
    say: "Got it. I'm hearing that from a lot of agents right now. Is the bigger challenge getting enough leads in general, or getting more listing appointments specifically?",
    lines: [
      {
        speaker: "rep",
        text: "Got it. I'm hearing that from a lot of agents right now. Is the bigger challenge getting enough leads in general, or getting more listing appointments specifically?",
      },
    ],
    coach:
      "Separate lead volume from seller appointment quality. WolfGrid is strongest when listings are the gap.",
    options: [
      { label: "Listing appointments", nextId: "seller-conversations" },
      { label: "Leads in general", nextId: "current-lead-source" },
      { label: "Not sure", nextId: "seller-conversations" },
    ],
  },
  {
    id: "current-lead-source",
    label: "Lead source",
    kind: "question",
    title: "Ask where business comes from",
    say: "That's good to hear. Are most of your opportunities coming from referrals, your database, online leads, open houses, or something else?",
    lines: [
      {
        speaker: "rep",
        text: "That's good to hear. Are most of your opportunities coming from referrals, your database, online leads, open houses, or something else?",
      },
    ],
    coach:
      "This keeps the call consultative. Listen for whether they already have seller demand or mostly buyer/referral activity.",
    options: [
      { label: "Referrals / database", nextId: "referral-fit" },
      { label: "Online leads", nextId: "online-leads-fit" },
      { label: "Open houses", nextId: "open-house-fit" },
      { label: "Not much", nextId: "seller-conversations" },
    ],
  },
  {
    id: "seller-conversations",
    label: "Seller question",
    kind: "question",
    title: "Find seller conversation gap",
    say: "Got it. And what are you currently doing to create seller conversations or generate new listing opportunities?",
    lines: [
      {
        speaker: "rep",
        text: "Got it. And what are you currently doing to create seller conversations or generate new listing opportunities?",
      },
    ],
    coach:
      "This is the core question. Do not pitch until you know how they currently create seller conversations.",
    options: [
      { label: "Not much", nextId: "position-flyr" },
      { label: "Referrals", nextId: "referral-fit" },
      { label: "Door knocking / farming", nextId: "field-prospecting-fit" },
      { label: "Paid leads", nextId: "online-leads-fit" },
      { label: "Enough sellers", nextId: "covered-right-now" },
    ],
  },
  {
    id: "referral-fit",
    label: "Referrals",
    kind: "question",
    title: "Referral-based business",
    say: "That makes sense. Referrals are usually the best business. Do you feel like referrals are consistent enough right now, or would it help to have another way to create seller conversations in the background?",
    lines: [
      {
        speaker: "rep",
        text: "That makes sense. Referrals are usually the best business. Do you feel like referrals are consistent enough right now, or would it help to have another way to create seller conversations in the background?",
      },
    ],
    coach:
      "Do not position against referrals. Position WolfGrid as a consistent second channel.",
    options: [
      { label: "Needs another channel", nextId: "position-flyr" },
      { label: "Referrals enough", nextId: "covered-right-now" },
      { label: "Curious", nextId: "position-flyr" },
    ],
  },
  {
    id: "online-leads-fit",
    label: "Paid leads",
    kind: "question",
    title: "Online or paid leads",
    say: "Got it. Are those mostly buyer leads, or are they turning into consistent listing appointments too?",
    lines: [
      {
        speaker: "rep",
        text: "Got it. Are those mostly buyer leads, or are they turning into consistent listing appointments too?",
      },
    ],
    coach:
      "Many paid lead sources are buyer-heavy. Keep the contrast around listing appointments, not lead volume.",
    options: [
      { label: "Mostly buyers", nextId: "position-flyr" },
      { label: "Some listings", nextId: "listing-volume-check" },
      { label: "Enough listings", nextId: "covered-right-now" },
    ],
  },
  {
    id: "open-house-fit",
    label: "Open houses",
    kind: "question",
    title: "Open house follow-up",
    say: "Nice. Are you using open houses mostly for buyer conversations, or are you also using them to create seller conversations in the neighbourhood?",
    lines: [
      {
        speaker: "rep",
        text: "Nice. Are you using open houses mostly for buyer conversations, or are you also using them to create seller conversations in the neighbourhood?",
      },
    ],
    coach:
      "Open houses are a bridge to neighbourhood prospecting. Use that if they already like in-person activity.",
    options: [
      { label: "Mostly buyers", nextId: "position-flyr" },
      { label: "Neighbourhood sellers", nextId: "field-prospecting-fit" },
      { label: "Not sure", nextId: "position-flyr" },
    ],
  },
  {
    id: "field-prospecting-fit",
    label: "Field work",
    kind: "question",
    title: "Already doing old-school prospecting",
    say: "That's exactly the lane WolfGrid is built for. Are you tracking the homes you visit, who you spoke with, who needs follow-up, and which conversations could turn into listing appointments?",
    lines: [
      {
        speaker: "rep",
        text: "That's exactly the lane WolfGrid is built for. Are you tracking the homes you visit, who you spoke with, who needs follow-up, and which conversations could turn into listing appointments?",
      },
    ],
    coach:
      "If they already do field work, the pain is usually organization, follow-up, and consistency.",
    options: [
      { label: "Not really", nextId: "position-flyr" },
      { label: "Manual tracking", nextId: "position-flyr" },
      { label: "Already tracked", nextId: "existing-system" },
    ],
  },
  {
    id: "listing-volume-check",
    label: "Listing volume",
    kind: "question",
    title: "Enough listing appointments?",
    say: "That's good. Do you feel like you have enough listing opportunities coming in each month, or is that still something you are trying to improve?",
    lines: [
      {
        speaker: "rep",
        text: "That's good. Do you feel like you have enough listing opportunities coming in each month, or is that still something you are trying to improve?",
      },
    ],
    coach:
      "Use their own target as the gap. If they have enough, exit cleanly.",
    options: [
      { label: "Trying to improve", nextId: "position-flyr" },
      { label: "Enough", nextId: "covered-right-now" },
    ],
  },
  {
    id: "existing-system",
    label: "Existing system",
    kind: "objection",
    title: "They already track it",
    say: "Makes sense. Most agents have something they use. WolfGrid is built specifically for old-school real estate prospecting, so the difference is that it maps the territory, keeps the follow-up organized, and helps turn conversations into listing appointments.",
    lines: [
      {
        speaker: "rep",
        text: "Makes sense. Most agents have something they use. WolfGrid is built specifically for old-school real estate prospecting, so the difference is that it maps the territory, keeps the follow-up organized, and helps turn conversations into listing appointments.",
      },
    ],
    coach:
      "Respect their current system. Position WolfGrid as the cleaner field layer.",
    options: [
      { label: "Ask for quick look", nextId: "demo-ask" },
      { label: "Asks price", nextId: "pricing" },
      { label: "Not interested", nextId: "graceful-close" },
    ],
  },
  {
    id: "position-flyr",
    label: "Position",
    kind: "question",
    title: "Position WolfGrid",
    say: "That is exactly why I reached out. WolfGrid helps individual Realtors create a repeatable way to get in front of homeowners, track the conversations, and turn the right ones into listing appointments. It is more old-school and relationship-based than just chasing internet leads.",
    lines: [
      {
        speaker: "rep",
        text: "That is exactly why I reached out. WolfGrid helps individual Realtors create a repeatable way to get in front of homeowners, track the conversations, and turn the right ones into listing appointments. It is more old-school and relationship-based than just chasing internet leads.",
      },
    ],
    coach:
      "Tie the pitch to what they just said. Keep it about seller conversations and appointments.",
    options: [
      { label: "Ask for quick look", nextId: "demo-ask" },
      { label: "They ask pricing", nextId: "pricing" },
      { label: "Need more info", nextId: "how-it-works" },
    ],
  },
  {
    id: "how-it-works",
    label: "How it works",
    kind: "question",
    title: "Simple explanation",
    say: "The simple version is: you choose the area you want to build listing inventory in, WolfGrid helps you work that area consistently, track every homeowner conversation, and make sure follow-up does not fall through the cracks.",
    lines: [
      {
        speaker: "rep",
        text: "The simple version is: you choose the area you want to build listing inventory in, WolfGrid helps you work that area consistently, track every homeowner conversation, and make sure follow-up does not fall through the cracks.",
      },
    ],
    coach:
      "Keep this practical. Do not explain every feature unless they ask.",
    options: [
      { label: "Ask for quick look", nextId: "demo-ask" },
      { label: "Asks price", nextId: "pricing" },
      { label: "Already covered", nextId: "covered-right-now" },
    ],
  },
  {
    id: "pricing",
    label: "Pricing",
    kind: "objection",
    title: "Answer pricing",
    say: "WolfGrid starts at $30 USD per user/month, which is about $40 CAD. The way I would think about it is simple: if it helps create even one extra listing appointment, it more than pays for itself.",
    lines: [
      {
        speaker: "rep",
        text: "WolfGrid starts at $30 USD per user/month, which is about $40 CAD. The way I would think about it is simple: if it helps create even one extra listing appointment, it more than pays for itself.",
      },
    ],
    coach:
      "Answer directly. Then return to the small next step instead of defending the price.",
    options: [
      { label: "Ask for quick look", nextId: "demo-ask" },
      { label: "Book demo", nextId: "book-demo" },
      { label: "No", nextId: "graceful-close" },
    ],
  },
  {
    id: "covered-right-now",
    label: "Covered",
    kind: "close",
    title: "They are covered right now",
    say: "That is great. Sounds like listings may not be the biggest gap for you right now. Would it still be okay if I sent over the quick demo so you have it in case that changes?",
    lines: [
      {
        speaker: "rep",
        text: "That is great. Sounds like listings may not be the biggest gap for you right now. Would it still be okay if I sent over the quick demo so you have it in case that changes?",
      },
    ],
    coach:
      "Do not force urgency. Convert to permission to send the demo or close cleanly.",
    options: [
      { label: "Send demo", nextId: "send-demo" },
      { label: "No", nextId: "graceful-close" },
    ],
  },
  {
    id: "not-growing-listings",
    label: "No listings focus",
    kind: "close",
    title: "Not focused on listings",
    say: "Got it. Then this probably is not a priority today. Appreciate you taking the call.",
    lines: [
      {
        speaker: "rep",
        text: "Got it. Then this probably is not a priority today. Appreciate you taking the call.",
      },
    ],
    coach:
      "Exit cleanly when the problem is not active. Mark the call outcome and move on.",
    options: [{ label: "Done", nextId: "done" }],
  },
  {
    id: "demo-ask",
    label: "Demo ask",
    kind: "close",
    title: "Book or send demo",
    say: "Would it be worth taking 10 or 15 minutes so I can show you how it works and see if it makes sense for your market?",
    lines: [
      {
        speaker: "rep",
        text: "Would it be worth taking 10 or 15 minutes so I can show you how it works and see if it makes sense for your market?",
      },
    ],
    coach:
      "This is the main close. Keep the commitment small and tied to their market.",
    options: [
      { label: "Book demo", nextId: "book-demo" },
      { label: "Send demo first", nextId: "send-demo" },
      { label: "Call later", nextId: "call-later" },
      { label: "No", nextId: "graceful-close" },
    ],
  },
  {
    id: "send-demo",
    label: "Send demo",
    kind: "close",
    title: "Send the demo",
    say: "Perfect. What is the best email or number to send it to? I will send the quick demo over, and if it looks useful we can book 10 minutes after.",
    lines: [
      {
        speaker: "rep",
        text: "Perfect. What is the best email or number to send it to? I will send the quick demo over, and if it looks useful we can book 10 minutes after.",
      },
    ],
    coach:
      "Confirm the destination, send it immediately, and create the follow-up task.",
    options: [
      { label: "Demo sent", nextId: "done" },
      { label: "Book follow-up", nextId: "book-demo" },
      { label: "Call later", nextId: "call-later" },
    ],
  },
  {
    id: "book-demo",
    label: "Book demo",
    kind: "close",
    title: "Book the follow-up",
    say: "Great. The easiest next step is 10 or 15 minutes. Does [Time 1] or [Time 2] work better?",
    lines: [
      {
        speaker: "rep",
        text: "Great. The easiest next step is 10 or 15 minutes. Does [Time 1] or [Time 2] work better?",
      },
    ],
    coach:
      "Offer two specific times. Do not leave the next step vague.",
    options: [
      { label: "Booked", nextId: "done" },
      { label: "Send demo first", nextId: "send-demo" },
      { label: "Call later", nextId: "call-later" },
    ],
  },
  {
    id: "call-later",
    label: "Call later",
    kind: "close",
    title: "Schedule callback",
    say: "No problem. I can call you back at [Time]. I will keep it focused on how you are creating seller conversations and whether WolfGrid could help.",
    lines: [
      {
        speaker: "rep",
        text: "No problem. I can call you back at [Time]. I will keep it focused on how you are creating seller conversations and whether WolfGrid could help.",
      },
    ],
    coach:
      "Set a real callback time and keep the reason specific.",
    options: [
      { label: "Callback set", nextId: "done" },
      { label: "Send demo only", nextId: "send-demo" },
    ],
  },
  {
    id: "graceful-close",
    label: "Close",
    kind: "close",
    title: "End cleanly",
    say: "No problem at all. Appreciate your time.",
    lines: [
      {
        speaker: "rep",
        text: "No problem at all. Appreciate your time.",
      },
    ],
    coach:
      "Do not argue. Mark not interested or not a fit and move to the next call.",
    options: [{ label: "Done", nextId: "done" }],
  },
  {
    id: "done",
    label: "Done",
    kind: "done",
    title: "Call complete",
    say: "Log the outcome, add the follow-up, and move to the next call.",
    coach:
      "The call must end with a clear disposition: demo sent, booked, callback set, covered, no fit, or not interested.",
    options: [{ label: "Start again", nextId: "opening" }],
  },
];

export const REAL_ESTATE_INDIVIDUAL_AGENT_SCRIPT_BODY = `Real Estate Individual Agents - listing appointments

OPENING:
Hey [Name], it's Daniel. Reason for the call today is I'm the founder of a software company called WolfGrid. We help Realtors get more listing appointments using more of an old-school approach.

I'd love to share a little more about the company, but first, how's business treating you so far this year?

CORE DISCOVERY:
Are most of your opportunities coming from referrals, your database, online leads, open houses, or something else?

SELLER CONVERSATION QUESTION:
What are you currently doing to create seller conversations or generate new listing opportunities?

POSITION WolfGrid:
That is exactly why I reached out. WolfGrid helps individual Realtors create a repeatable way to get in front of homeowners, track the conversations, and turn the right ones into listing appointments. It is more old-school and relationship-based than just chasing internet leads.

CLOSE:
Would it be worth taking 10 or 15 minutes so I can show you how it works and see if it makes sense for your market?

REP RULES:
1. Lead with curiosity before pitching.
2. Keep the focus on seller conversations and listing appointments.
3. Do not position against referrals; position WolfGrid as another consistent channel.
4. If they are covered, ask permission to send the quick demo or close cleanly.
5. Always end with a next step: book demo, send demo, set callback, or mark not interested.`;

export const INDIVIDUAL_REALTOR_LISTING_LEVERAGE_SCRIPT_FLOW: StarterScriptFlowNode[] = [
  {
    id: "opener",
    label: "Opener",
    kind: "start",
    title: "Quick opener",
    say: "Hey [Name], this is Daniel calling from WolfGrid. How are you?",
    lines: [
      {
        speaker: "rep",
        text: "Hey [Name], this is Daniel calling from WolfGrid. How are you?",
      },
    ],
    coach:
      "Use a downward inflection on the last line. Keep it calm and familiar.",
    options: [
      { label: "Not interested", nextId: "not-interested" },
      { label: "Dont doorknock", nextId: "door-knock-objection" },
      { label: "FLYERS", nextId: "flyers-response" },
      { label: "SOCIAL MEDIA", nextId: "social-media-response" },
      { label: "DOORKNOCK", nextId: "doorknock-response" },
    ],
  },
  {
    id: "quick-intro",
    label: "Intro",
    kind: "objection",
    title: "If they ask who is calling",
    say: "It's Daniel from WolfGrid. I built software for real estate agents to help turn a current listing into the next listing nearby.",
    lines: [
      {
        speaker: "rep",
        text: "It's Daniel from WolfGrid. I built software for real estate agents to help turn a current listing into the next listing nearby.",
      },
    ],
    coach:
      "Answer directly, then return to the value statement. Do not over-explain.",
    options: [
      { label: "Continue", nextId: "value-statement" },
      { label: "Not interested", nextId: "not-interested" },
    ],
  },
  {
    id: "busy",
    label: "Busy",
    kind: "objection",
    title: "If they are busy",
    say: "WolfGrid isn't really for when business is dead.\n\nIt's for when business is moving - because every listing you sell creates attention, curiosity, and warm conversations around it.\n\nThe problem is most agents are so focused on getting the deal closed that they miss the business sitting around the listing.\n\nThen 30, 60, 90 days later, they're back looking for the next deal from scratch.\n\nWolfGrid helps make sure the listing you just worked hard to sell actually feeds your pipeline instead of becoming a one-and-done transaction.\n\nSo it's not \"go door knock because you're not busy.\"\n\nIt's \"you're already creating attention - let's make sure you don't waste it.\"\n\nWould it be worth a quick look if I sent you the demo?",
    lines: [
      {
        speaker: "person",
        text: "I'm busy right now.",
      },
      {
        speaker: "rep",
        text: "WolfGrid isn't really for when business is dead.\n\nIt's for when business is moving - because every listing you sell creates attention, curiosity, and warm conversations around it.\n\nThe problem is most agents are so focused on getting the deal closed that they miss the business sitting around the listing.\n\nThen 30, 60, 90 days later, they're back looking for the next deal from scratch.\n\nWolfGrid helps make sure the listing you just worked hard to sell actually feeds your pipeline instead of becoming a one-and-done transaction.\n\nSo it's not \"go door knock because you're not busy.\"\n\nIt's \"you're already creating attention - let's make sure you don't waste it.\"\n\nWould it be worth a quick look if I sent you the demo?",
      },
    ],
    coach:
      "Reframe busy as the right moment to capture listing attention before it fades.",
    options: [
      { label: "Send demo", nextId: "close" },
      { label: "Call later", nextId: "call-later" },
      { label: "Let me think", nextId: "hesitation-close" },
      { label: "No", nextId: "graceful-close" },
    ],
  },
  {
    id: "flyers-response",
    label: "Flyers",
    kind: "question",
    title: "They use flyers",
    say: "That is awesome.\n\nHave you considered the opportunity to speak to the homeowners around the listing?\n\nWolfGrid turns that same listing area into a trackable campaign, so the map, flyer drops, conversations, and follow-up all stay organized in one place.\n\nWould it be worth a quick look if I sent you the demo?",
    lines: [
      {
        speaker: "rep",
        text: "That is awesome.\n\nHave you considered the opportunity to speak to the homeowners around the listing?\n\nWolfGrid turns that same listing area into a trackable campaign, so the map, flyer drops, conversations, and follow-up all stay organized in one place.\n\nWould it be worth a quick look if I sent you the demo?",
      },
    ],
    coach:
      "Affirm what they already do, then point toward homeowner conversations around the listing.",
    options: [
      { label: "Send demo", nextId: "close" },
      { label: "They ask how it works", nextId: "how-it-works" },
      { label: "Product info", nextId: "product-info" },
      { label: "They ask price", nextId: "price" },
      { label: "No time", nextId: "time-objection" },
      { label: "No", nextId: "graceful-close" },
    ],
  },
  {
    id: "social-media-response",
    label: "Social media",
    kind: "question",
    title: "They use social media",
    say: "That is awesome.\n\nHave you considered the opportunity to speak to the homeowners around the listing?\n\nWolfGrid gives you the map and pipeline around the listing, so the attention from social can turn into actual homeowner conversations.\n\nWould it be worth a quick look if I sent you the demo?",
    lines: [
      {
        speaker: "rep",
        text: "That is awesome.\n\nHave you considered the opportunity to speak to the homeowners around the listing?\n\nWolfGrid gives you the map and pipeline around the listing, so the attention from social can turn into actual homeowner conversations.\n\nWould it be worth a quick look if I sent you the demo?",
      },
    ],
    coach:
      "Affirm what they already do, then point toward homeowner conversations around the listing.",
    options: [
      { label: "Send demo", nextId: "close" },
      { label: "They ask how it works", nextId: "how-it-works" },
      { label: "Product info", nextId: "product-info" },
      { label: "They ask price", nextId: "price" },
      { label: "No time", nextId: "time-objection" },
      { label: "No", nextId: "graceful-close" },
    ],
  },
  {
    id: "doorknock-response",
    label: "Doorknock",
    kind: "question",
    title: "They already door knock",
    say: "Love that - that means you already believe in the activity, you're just doing it manually. Our software does the same canvassing, it just tracks every door, every conversation, and builds the 3D map automatically so you're not carrying a clipboard or losing data when you switch streets. You'd plug straight into what you're already doing. Want me to send the included campaign link now so you can run it on your current listing?",
    lines: [
      {
        speaker: "rep",
        text: "Love that - that means you already believe in the activity, you're just doing it manually. Our software does the same canvassing, it just tracks every door, every conversation, and builds the 3D map automatically so you're not carrying a clipboard or losing data when you switch streets. You'd plug straight into what you're already doing. Want me to send the included campaign link now so you can run it on your current listing?",
      },
    ],
    coach:
      "This is the strongest fit path. Reinforce the work they already do and make WolfGrid the system around it.",
    options: [
      { label: "Send demo", nextId: "close" },
      { label: "They ask how it works", nextId: "how-it-works" },
      { label: "Product info", nextId: "product-info" },
      { label: "They ask price", nextId: "price" },
      { label: "Already has CRM", nextId: "tool-overlap-objection" },
      { label: "No", nextId: "graceful-close" },
    ],
  },
  {
    id: "not-interested",
    label: "No interest",
    kind: "objection",
    title: "If they say not interested",
    say: "Totally fair. Before I let you go, can I send you a 90 second demo if you ever change your mind?",
    lines: [
      {
        speaker: "rep",
        text: "Totally fair. Before I let you go, can I send you a 90 second demo if you ever change your mind?",
      },
    ],
    coach:
      "Keep it low pressure. The goal is only permission to send the short demo.",
    options: [
      { label: "Yes", nextId: "close" },
      { label: "No", nextId: "graceful-close" },
    ],
  },
  {
    id: "value-statement",
    label: "Value",
    kind: "question",
    title: "30-second value statement",
    say: "Reason I'm calling - I built a software for real estate agents that creates a 3D map of every house around your listing and automatically tracks the doors and conversations you have so you can leverage your current listing to find your next one.\n\nWe're currently offering one included campaign to agents in [city], and by the end of this call I'd like to send you the software to try out for yourself.",
    lines: [
      {
        speaker: "rep",
        text: "Reason I'm calling - I built a software for real estate agents that creates a 3D map of every house around your listing and automatically tracks the doors and conversations you have so you can leverage your current listing to find your next one.\n\nWe're currently offering one included campaign to agents in [city], and by the end of this call I'd like to send you the software to try out for yourself.",
      },
    ],
    coach:
      "Keep this around 30 seconds. Say it cleanly, then move straight into the qualifier.",
    options: [
      { label: "They ask how it works", nextId: "how-it-works" },
      { label: "Product info", nextId: "product-info" },
      { label: "They ask price", nextId: "price" },
      { label: "No time", nextId: "time-objection" },
      { label: "Does it work?", nextId: "belief-objection" },
      { label: "Not a priority", nextId: "priority-objection" },
      { label: "Already has CRM", nextId: "tool-overlap-objection" },
    ],
  },
  {
    id: "qualifier",
    label: "Qualifier",
    kind: "question",
    title: "Ask how they leverage listings",
    say: "How are you currently leveraging your listing for new business?",
    lines: [
      {
        speaker: "rep",
        text: "How are you currently leveraging your listing for new business?",
      },
    ],
    coach:
      "Listen fully and respond naturally to their answer. The question should feel curious, not like a checklist.",
    options: [
      { label: "They doorknock / farm", nextId: "field-fit" },
      { label: "Open houses / signs / social", nextId: "natural-response" },
      { label: "Not much right now", nextId: "natural-response" },
      { label: "No time", nextId: "time-objection" },
      { label: "Not a priority", nextId: "priority-objection" },
      { label: "Already wants demo", nextId: "close" },
    ],
  },
  {
    id: "field-fit",
    label: "Field fit",
    kind: "question",
    title: "They already prospect around listings",
    say: "That is exactly where WolfGrid fits. If you are already talking to people around the listing, the software gives you the map, tracks each door and conversation, and keeps the follow-up organized so none of that activity disappears.",
    lines: [
      {
        speaker: "rep",
        text: "That is exactly where WolfGrid fits. If you are already talking to people around the listing, the software gives you the map, tracks each door and conversation, and keeps the follow-up organized so none of that activity disappears.",
      },
    ],
    coach:
      "Connect WolfGrid to what they already do. Make it feel like leverage, not a new job.",
    options: [
      { label: "Close for text", nextId: "close" },
      { label: "They ask how it works", nextId: "how-it-works" },
      { label: "Product info", nextId: "product-info" },
      { label: "They ask price", nextId: "price" },
      { label: "No time", nextId: "time-objection" },
      { label: "Does it work?", nextId: "belief-objection" },
      { label: "Already has CRM", nextId: "tool-overlap-objection" },
    ],
  },
  {
    id: "natural-response",
    label: "Bridge",
    kind: "question",
    title: "Respond naturally, then bridge",
    say: "That makes sense. Most agents are doing pieces of it already - signs, open houses, social posts, maybe a few conversations nearby. WolfGrid just makes the neighbourhood around the listing visible and trackable so you can turn that listing into a repeatable source of new conversations.",
    lines: [
      {
        speaker: "rep",
        text: "That makes sense. Most agents are doing pieces of it already - signs, open houses, social posts, maybe a few conversations nearby. WolfGrid just makes the neighbourhood around the listing visible and trackable so you can turn that listing into a repeatable source of new conversations.",
      },
    ],
    coach:
      "Mirror their answer first. Then make the close simple: send the demo and included campaign.",
    options: [
      { label: "Close for text", nextId: "close" },
      { label: "They ask how it works", nextId: "how-it-works" },
      { label: "Product info", nextId: "product-info" },
      { label: "They ask price", nextId: "price" },
      { label: "No time", nextId: "time-objection" },
      { label: "Does it work?", nextId: "belief-objection" },
      { label: "Not a priority", nextId: "priority-objection" },
      { label: "Already has CRM", nextId: "tool-overlap-objection" },
    ],
  },
  {
    id: "how-it-works",
    label: "How it works",
    kind: "question",
    title: "Simple product explanation",
    say: "The simple version is: you pick the listing, WolfGrid maps the surrounding homes in 3D, you work the doors or conversations around it, and the app tracks who you spoke to, what happened, and who needs follow-up.",
    lines: [
      {
        speaker: "rep",
        text: "The simple version is: you pick the listing, WolfGrid maps the surrounding homes in 3D, you work the doors or conversations around it, and the app tracks who you spoke to, what happened, and who needs follow-up.",
      },
    ],
    coach:
      "Keep this practical. Do not turn the product explanation into a full demo on the call.",
    options: [
      { label: "Close for text", nextId: "close" },
      { label: "Ask qualifier", nextId: "qualifier" },
      { label: "Product info", nextId: "product-info" },
      { label: "They ask price", nextId: "price" },
      { label: "Does it work?", nextId: "belief-objection" },
      { label: "Already has CRM", nextId: "tool-overlap-objection" },
    ],
  },
  {
    id: "product-info",
    label: "Product",
    kind: "question",
    title: "Product info snippet",
    say: "Quick product example: on the web, you create a campaign by drawing the territory around your listing. WolfGrid then creates a 3D map of the homes in that area, with different colours for different states.\n\nThen on the iOS app, when you're walking the neighbourhood, you can update each home as you go: not home, answered, lead, follow-up, or whatever state makes sense for your process. So the map becomes the system for organizing every conversation around the listing.\n\nTwo cool things worth mentioning: WolfGrid automatically tracks every house you hit using GPS, so you don't have to pull out your phone as much, and it has auto-recorded notes so you can keep detailed notes fast without writing messy notes in a spreadsheet.\n\nWould it be worth a quick look if I sent you the demo?",
    lines: [
      {
        speaker: "rep",
        text: "Quick product example: on the web, you create a campaign by drawing the territory around your listing. WolfGrid then creates a 3D map of the homes in that area, with different colours for different states.\n\nThen on the iOS app, when you're walking the neighbourhood, you can update each home as you go: not home, answered, lead, follow-up, or whatever state makes sense for your process. So the map becomes the system for organizing every conversation around the listing.\n\nTwo cool things worth mentioning: WolfGrid automatically tracks every house you hit using GPS, so you don't have to pull out your phone as much, and it has auto-recorded notes so you can keep detailed notes fast without writing messy notes in a spreadsheet.\n\nWould it be worth a quick look if I sent you the demo?",
      },
    ],
    coach:
      "Use this when they ask what the product actually does. Keep it practical: draw territory on web, work and update the map from the iOS app.",
    options: [
      { label: "Send demo", nextId: "close" },
      { label: "They ask price", nextId: "price" },
      { label: "Already has CRM", nextId: "tool-overlap-objection" },
      { label: "Let me think", nextId: "hesitation-close" },
    ],
  },
  {
    id: "price",
    label: "Price",
    kind: "objection",
    title: "If they ask pricing",
    say: "Totally fair question.\n\nRight now we're giving agents one included campaign so they can actually see it before making a decision.\n\nBut before we get to price, can I ask: if one listing campaign helped you create one listing, on average what would that be worth in terms of commission?\n\nOk cool. Well, I'm not a mathematician, but with WolfGrid costing $300 for the year, if it brings one listing it will pay itself off for the next 3 decades, right?\n\nRight. The scary part is if you implement this, you'll see much more than one listing per year. It will go down as the single best return on investment you'll ever make.\n\nDo you want to see the included campaign?",
    lines: [
      {
        speaker: "rep",
        text: "Totally fair question.\n\nRight now we're giving agents one included campaign so they can actually see it before making a decision.\n\nBut before we get to price, can I ask: if one listing campaign helped you create one listing, on average what would that be worth in terms of commission?\n\nOk cool. Well, I'm not a mathematician, but with WolfGrid costing $300 for the year, if it brings one listing it will pay itself off for the next 3 decades, right?\n\nRight. The scary part is if you implement this, you'll see much more than one listing per year. It will go down as the single best return on investment you'll ever make.\n\nDo you want to see the included campaign?",
      },
    ],
    coach:
      "Use the included campaign first, then anchor the annual cost against the value of one listing.",
    options: [
      { label: "Close for text", nextId: "close" },
      { label: "Need broker/team", nextId: "authority-objection" },
      { label: "Let me think", nextId: "hesitation-close" },
      { label: "No", nextId: "graceful-close" },
    ],
  },
  {
    id: "time-objection",
    label: "Time",
    kind: "objection",
    title: "We don't have time",
    say: "Totally hear you - most agents don't have extra time.\n\nBut let me ask you this: when you do have limited time to prospect, would you rather spend it randomly, or around a listing where the neighbours are already paying attention?\n\nExactly.\n\nThat's the whole reason we built WolfGrid. Most agents know the area around a listing is one of the warmest places to create conversations, but it usually gets missed because there's no simple system to execute it.\n\nWolfGrid turns the listing into a visual 3D campaign, shows you every home nearby, tracks the outreach, and keeps the follow-up organized. So it's not about adding more work - it's about making the work you already should be doing easier to execute.\n\nWould it be worth a quick look if I sent you the demo?",
    lines: [
      {
        speaker: "person",
        text: "We don't have time.",
      },
      {
        speaker: "rep",
        text: "Totally hear you - most agents don't have extra time.\n\nBut let me ask you this: when you do have limited time to prospect, would you rather spend it randomly, or around a listing where the neighbours are already paying attention?\n\nExactly.\n\nThat's the whole reason we built WolfGrid. Most agents know the area around a listing is one of the warmest places to create conversations, but it usually gets missed because there's no simple system to execute it.\n\nWolfGrid turns the listing into a visual 3D campaign, shows you every home nearby, tracks the outreach, and keeps the follow-up organized. So it's not about adding more work - it's about making the work you already should be doing easier to execute.\n\nWould it be worth a quick look if I sent you the demo?",
      },
    ],
    coach:
      "Reframe time around leverage. The pitch is not more prospecting; it is using the warmest area first.",
    options: [
      { label: "Send demo", nextId: "close" },
      { label: "Need broker/team", nextId: "authority-objection" },
      { label: "Let me think", nextId: "hesitation-close" },
      { label: "No", nextId: "graceful-close" },
    ],
  },
  {
    id: "belief-objection",
    label: "Belief",
    kind: "objection",
    title: "Does this actually work?",
    say: "Totally fair.\n\nLet me ask you this: when a home sells in a neighbourhood, do you think the surrounding homeowners notice?\n\nExactly.\n\nThey see the sign, the open house, the sold sign, and they naturally start thinking about what their own home might be worth. Speaking to homeowners at that time makes sense. The issue is most agents don't have a system to actually capitalize on that attention.\n\nThat's what WolfGrid gives you. A 3D prospecting map around the listing, door tracking, notes, conversations, and follow-up - all organized in one place. So it's not magic. It's just helping agents execute a strategy they already know works.\n\nWould it be worth a quick look if I sent you the demo?",
    lines: [
      {
        speaker: "person",
        text: "Does this actually work?",
      },
      {
        speaker: "rep",
        text: "Totally fair.\n\nLet me ask you this: when a home sells in a neighbourhood, do you think the surrounding homeowners notice?\n\nExactly.\n\nThey see the sign, the open house, the sold sign, and they naturally start thinking about what their own home might be worth. Speaking to homeowners at that time makes sense. The issue is most agents don't have a system to actually capitalize on that attention.\n\nThat's what WolfGrid gives you. A 3D prospecting map around the listing, door tracking, notes, conversations, and follow-up - all organized in one place. So it's not magic. It's just helping agents execute a strategy they already know works.\n\nWould it be worth a quick look if I sent you the demo?",
      },
    ],
    coach:
      "Make the strategy feel obvious. WolfGrid is the execution system, not a magic promise.",
    options: [
      { label: "Send demo", nextId: "close" },
      { label: "They ask price", nextId: "price" },
      { label: "Let me think", nextId: "hesitation-close" },
      { label: "No", nextId: "graceful-close" },
    ],
  },
  {
    id: "priority-objection",
    label: "Priority",
    kind: "objection",
    title: "We're not focused on that right now",
    say: "Totally hear you.\n\nLet me ask you this - after you sell a listing, do you think that street is colder or warmer than it was before the sale?\n\nExactly.\n\nThat is the whole opportunity.\n\nYou already did the hard part. You won the listing, marketed it, got the result, and created curiosity in the neighbourhood.\n\nRight after the sale is when the community is paying the most attention. Homeowners nearby are wondering what their place is worth, who else might sell, and whether the market is moving.\n\nThose are some of the warmest listing conversations an agent can have.\n\nBut most agents miss that window. They sell the home, move on, and start prospecting from scratch again.\n\nThat is what WolfGrid helps with.\n\nIt turns every listing into a 3D prospecting campaign, maps every home nearby, tracks the outreach, and keeps the follow-up organized. Whether you door knock, call, mail, or have your team work the area, the point is having a system to capitalize on the attention your listing already created.\n\nWould it be worth a quick look if I sent you the demo?",
    lines: [
      {
        speaker: "person",
        text: "We're not focused on that right now.",
      },
      {
        speaker: "rep",
        text: "Totally hear you.\n\nLet me ask you this - after you sell a listing, do you think that street is colder or warmer than it was before the sale?\n\nExactly.\n\nThat is the whole opportunity.\n\nYou already did the hard part. You won the listing, marketed it, got the result, and created curiosity in the neighbourhood.\n\nRight after the sale is when the community is paying the most attention. Homeowners nearby are wondering what their place is worth, who else might sell, and whether the market is moving.\n\nThose are some of the warmest listing conversations an agent can have.\n\nBut most agents miss that window. They sell the home, move on, and start prospecting from scratch again.\n\nThat is what WolfGrid helps with.\n\nIt turns every listing into a 3D prospecting campaign, maps every home nearby, tracks the outreach, and keeps the follow-up organized. Whether you door knock, call, mail, or have your team work the area, the point is having a system to capitalize on the attention your listing already created.\n\nWould it be worth a quick look if I sent you the demo?",
      },
    ],
    coach:
      "Reposition the issue as capturing attention that already exists around a listing.",
    options: [
      { label: "Send demo", nextId: "close" },
      { label: "Need broker/team", nextId: "authority-objection" },
      { label: "Let me think", nextId: "hesitation-close" },
      { label: "No", nextId: "graceful-close" },
    ],
  },
  {
    id: "interrupting-homeowners-objection",
    label: "Interrupting homeowners",
    kind: "objection",
    title: "Interrupting homeowners",
    say: "Totally hear you - nobody wants to feel like they're bothering people at the door.\n\nBut the way I look at it is this:\n\nYou're not interrupting them with something random.\n\nYou just sold a house in their neighbourhood - and for most homeowners, their home is their most valuable asset.\n\nThey work every day, pay down the mortgage, build equity, and a sale on their street directly affects what their own home could be worth.\n\nSo when a property nearby sells, there is already natural curiosity.\n\nThey want to know what happened, what it sold for, how many buyers were interested, and what it could mean for their home.\n\nThe problem is most agents assume they're bothering people, so they never start the conversation.\n\nWolfGrid helps you turn that listing into a simple neighbourhood campaign so you can approach those homeowners with context, track who you spoke with, and follow up properly.\n\nIt's not just door knocking.\n\nIt's using the attention your listing already created to start relevant conversations.\n\nWould it be worth a quick look if I sent you the demo?",
    lines: [
      {
        speaker: "person",
        text: "I don't want to interrupt homeowners.",
      },
      {
        speaker: "rep",
        text: "Totally hear you - nobody wants to feel like they're bothering people at the door.\n\nBut the way I look at it is this:\n\nYou're not interrupting them with something random.\n\nYou just sold a house in their neighbourhood - and for most homeowners, their home is their most valuable asset.\n\nThey work every day, pay down the mortgage, build equity, and a sale on their street directly affects what their own home could be worth.\n\nSo when a property nearby sells, there is already natural curiosity.\n\nThey want to know what happened, what it sold for, how many buyers were interested, and what it could mean for their home.\n\nThe problem is most agents assume they're bothering people, so they never start the conversation.\n\nWolfGrid helps you turn that listing into a simple neighbourhood campaign so you can approach those homeowners with context, track who you spoke with, and follow up properly.\n\nIt's not just door knocking.\n\nIt's using the attention your listing already created to start relevant conversations.\n\nWould it be worth a quick look if I sent you the demo?",
      },
    ],
    coach:
      "Reframe the outreach as a relevant conversation created by the listing, not a random interruption.",
    options: [
      { label: "Send demo", nextId: "close" },
      { label: "They ask price", nextId: "price" },
      { label: "Let me think", nextId: "hesitation-close" },
      { label: "No", nextId: "graceful-close" },
    ],
  },
  {
    id: "door-knock-objection",
    label: "Dont doorknock",
    kind: "objection",
    title: "I don't door knock",
    say: "Totally hear you.\n\nLet me ask you this: when you sell a listing, do you think talking to homeowners around that property will create more listing opportunities?\n\nExactly. It's less about door knocking and more about not wasting the attention your listing already created.\n\nMost agents know talking to the neighbourhood after a sale can create more business. The reason they don't is because they don't have a simple system to execute it.\n\nThat's what WolfGrid is. It helps you turn every listing into a 3D prospecting campaign, map every home nearby, track the outreach, and follow up properly. So whether you door knock, call, mail, or have your team work the area - the point is having a system around the listing.\n\nWould it be worth a quick look if I sent you the demo?",
    lines: [
      {
        speaker: "person",
        text: "I don't door knock.",
      },
      {
        speaker: "rep",
        text: "Totally hear you.\n\nLet me ask you this: when you sell a listing, do you think talking to homeowners around that property will create more listing opportunities?\n\nExactly. It's less about door knocking and more about not wasting the attention your listing already created.\n\nMost agents know talking to the neighbourhood after a sale can create more business. The reason they don't is because they don't have a simple system to execute it.\n\nThat's what WolfGrid is. It helps you turn every listing into a 3D prospecting campaign, map every home nearby, track the outreach, and follow up properly. So whether you door knock, call, mail, or have your team work the area - the point is having a system around the listing.\n\nWould it be worth a quick look if I sent you the demo?",
      },
    ],
    coach:
      "Use the door-knock objection route. Reframe the point as capturing listing attention, not forcing one outreach method.",
    options: [
      { label: "Send demo", nextId: "close" },
      { label: "They ask price", nextId: "price" },
      { label: "Let me think", nextId: "hesitation-close" },
      { label: "No", nextId: "graceful-close" },
    ],
  },
  {
    id: "tool-overlap-objection",
    label: "CRM",
    kind: "objection",
    title: "I already use a CRM",
    say: "Let me ask you this though: does your CRM tell you which homes around your listing haven't been talked to yet, or does it just store leads after you already have them?\n\nExactly.\n\nThat's the difference. WolfGrid isn't competing with your CRM - it's what feeds it. Your CRM organizes leads you already have. WolfGrid is what finds and tracks the leads around your listing before they exist anywhere else.\n\nWould it be worth a quick look if I sent you the demo?",
    lines: [
      {
        speaker: "person",
        text: "I already use a CRM. I don't need another tool.",
      },
      {
        speaker: "rep",
        text: "Let me ask you this though: does your CRM tell you which homes around your listing haven't been talked to yet, or does it just store leads after you already have them?\n\nExactly.\n\nThat's the difference. WolfGrid isn't competing with your CRM - it's what feeds it. Your CRM organizes leads you already have. WolfGrid is what finds and tracks the leads around your listing before they exist anywhere else.\n\nWould it be worth a quick look if I sent you the demo?",
      },
    ],
    coach:
      "Do not compete with the CRM. Position WolfGrid as the pre-lead field layer that feeds the CRM.",
    options: [
      { label: "Send demo", nextId: "close" },
      { label: "They ask price", nextId: "price" },
      { label: "Let me think", nextId: "hesitation-close" },
      { label: "No", nextId: "graceful-close" },
    ],
  },
  {
    id: "authority-objection",
    label: "Authority",
    kind: "objection",
    title: "Need to run it by team or broker",
    say: "Totally makes sense.\n\nQuick question: when you bring it to them, would it help more if you already had the demo in hand, or would you rather I send something both of you can look at together?\n\nExactly. Let me send you the demo now so you've got something concrete to show them - way easier than trying to explain it from memory.\n\nWhat's the best number to text it to?",
    lines: [
      {
        speaker: "person",
        text: "I'd need to run this by my team or broker.",
      },
      {
        speaker: "rep",
        text: "Totally makes sense.\n\nQuick question: when you bring it to them, would it help more if you already had the demo in hand, or would you rather I send something both of you can look at together?\n\nExactly. Let me send you the demo now so you've got something concrete to show them - way easier than trying to explain it from memory.\n\nWhat's the best number to text it to?",
      },
    ],
    coach:
      "Agree with the approval step, then make the demo the thing they can forward or show.",
    options: [
      { label: "Number captured", nextId: "send-trial" },
      { label: "Email instead", nextId: "email-instead" },
      { label: "No", nextId: "graceful-close" },
    ],
  },
  {
    id: "hesitation-close",
    label: "Think",
    kind: "objection",
    title: "Let me think about it",
    say: "Totally fair, no pressure.\n\nCan I ask what specifically you'd want to think through - is it whether it'll work for your business, or just timing?\n\nEither way, the easiest way to actually think it through is having the demo in front of you instead of trying to remember this call. Mind if I send it over?",
    lines: [
      {
        speaker: "person",
        text: "Let me think about it.",
      },
      {
        speaker: "rep",
        text: "Totally fair, no pressure.\n\nCan I ask what specifically you'd want to think through - is it whether it'll work for your business, or just timing?\n\nEither way, the easiest way to actually think it through is having the demo in front of you instead of trying to remember this call. Mind if I send it over?",
      },
    ],
    coach:
      "Find the real hesitation, then reduce the decision to reviewing the demo.",
    options: [
      { label: "Send demo", nextId: "close" },
      { label: "Timing", nextId: "call-later" },
      { label: "No", nextId: "graceful-close" },
    ],
  },
  {
    id: "close",
    label: "Close",
    kind: "close",
    title: "Text demo and included campaign",
    say: "What's the best number to text that demo and included campaign to?",
    lines: [
      {
        speaker: "rep",
        text: "What's the best number to text that demo and included campaign to?",
      },
    ],
    coach:
      "This is the goal of the call. Ask, then stop talking and let them give the number.",
    options: [
      { label: "Number captured", nextId: "send-trial" },
      { label: "Email instead", nextId: "email-instead" },
      { label: "Call later", nextId: "call-later" },
      { label: "Need broker/team", nextId: "authority-objection" },
      { label: "Let me think", nextId: "hesitation-close" },
      { label: "No", nextId: "graceful-close" },
    ],
  },
  {
    id: "email-instead",
    label: "Email",
    kind: "close",
    title: "If they prefer email",
    say: "No problem. What is the best email to send the demo and included campaign to?",
    lines: [
      {
        speaker: "rep",
        text: "No problem. What is the best email to send the demo and included campaign to?",
      },
    ],
    coach:
      "Capture the email, confirm spelling, and send the access immediately.",
    options: [{ label: "Email captured", nextId: "send-trial" }],
  },
  {
    id: "call-later",
    label: "Later",
    kind: "close",
    title: "Schedule callback",
    say: "No problem. When is a better time for me to call back and send you the demo?",
    lines: [
      {
        speaker: "rep",
        text: "No problem. When is a better time for me to call back and send you the demo?",
      },
    ],
    coach:
      "Set a real callback time. If they will allow it, send the demo before the callback.",
    options: [
      { label: "Callback set", nextId: "done" },
      { label: "Send campaign now", nextId: "send-trial" },
    ],
  },
  {
    id: "send-trial",
    label: "Send",
    kind: "done",
    title: "Send access",
    say: "Text the demo and included campaign, log the number, and set the follow-up.",
    lines: [
      {
        speaker: "rep",
        text: "Text the demo and included campaign, log the number, and set the follow-up.",
      },
    ],
    coach:
      "Complete the handoff before moving to the next lead.",
    options: [{ label: "Start again", nextId: "opener" }],
  },
  {
    id: "graceful-close",
    label: "Close",
    kind: "close",
    title: "End cleanly",
    say: "No problem at all. Appreciate your time.",
    lines: [
      {
        speaker: "rep",
        text: "No problem at all. Appreciate your time.",
      },
    ],
    coach:
      "Do not argue. Mark the outcome and move on.",
    options: [{ label: "Done", nextId: "done" }],
  },
  {
    id: "done",
    label: "Done",
    kind: "done",
    title: "Call complete",
    say: "Log the call outcome, add any follow-up, and move to the next call.",
    lines: [
      {
        speaker: "rep",
        text: "Log the call outcome, add any follow-up, and move to the next call.",
      },
    ],
    coach:
      "The desired outcome is demo and included campaign sent by text.",
    options: [{ label: "Start again", nextId: "opener" }],
  },
];

export const INDIVIDUAL_REALTOR_LISTING_LEVERAGE_SCRIPT_BODY = `Individual Realtors - listing leverage campaign

OPENER:
Hey [Name], this is Daniel calling from WolfGrid. How are you?

VALUE STATEMENT:
Reason I'm calling - I built a software for real estate agents that creates a 3D map of every house around your listing and automatically tracks the doors and conversations you have so you can leverage your current listing to find your next one.

We're currently offering one included campaign to agents in [city], and by the end of this call I'd like to send you the software to try out for yourself.

QUALIFIER:
How are you currently leveraging your listing for new business?

Listen, then respond naturally to their answer.

CLOSE:
What's the best number to text that demo and included campaign to?

PRODUCT INFO SNIPPET:
Quick product example: on the web, you create a campaign by drawing the territory around your listing. WolfGrid then creates a 3D map of the homes in that area, with different colours for different states.

Then on the iOS app, when you're walking the neighbourhood, you can update each home as you go: not home, answered, lead, follow-up, or whatever state makes sense for your process. So the map becomes the system for organizing every conversation around the listing.

Two cool things worth mentioning: WolfGrid automatically tracks every house you hit using GPS, so you don't have to pull out your phone as much, and it has auto-recorded notes so you can keep detailed notes fast without writing messy notes in a spreadsheet.

Would it be worth a quick look if I sent you the demo?

OBJECTION HANDLES:
Time:
Totally hear you - most agents don't have extra time. When you do have limited time to prospect, would you rather spend it randomly, or around a listing where the neighbours are already paying attention?

Money:
Right now we're giving agents one included campaign so they can actually see it before making a decision. If one listing campaign helped you create one listing, what would that be worth in commission? WolfGrid costs $300 for the year, so one listing pays it off for years.

Belief:
When a home sells in a neighbourhood, the surrounding homeowners notice. WolfGrid is not magic; it helps agents execute a strategy they already know works with a 3D map, door tracking, notes, conversations, and follow-up.

Priority:
It is less about door knocking and more about not wasting the attention your listing already created. WolfGrid gives you a system around the listing whether you knock, call, mail, or have your team work the area.

CRM overlap:
Your CRM organizes leads you already have. WolfGrid finds and tracks the leads around your listing before they exist anywhere else.

Authority:
Let me send you the demo now so you have something concrete to show your team or broker.

Hesitation:
The easiest way to think it through is having the demo in front of you instead of trying to remember this call.

REP RULES:
1. Use downward inflection on the opener.
2. Keep the value statement around 30 seconds.
3. Ask the qualifier before explaining more.
4. Mirror their answer naturally before closing.
5. The goal is to text the demo and included campaign.`;

export const REAL_ESTATE_QUICK_DEMO_SCRIPT_FLOW: StarterScriptFlowNode[] = [
  {
    id: "opening",
    label: "Opening",
    kind: "start",
    title: "Warm opener",
    say: "Hey [Name], how are you today?\nGood, how are you?\nGreat! My name is [Rep Name] with WolfGrid. We are a door-to-door software built to help real estate teams track, manage, and organize their field prospecting.\nDoes your team currently hand out flyers or door knock?",
    lines: [
      { speaker: "rep", text: "Hey [Name], how are you today?" },
      { speaker: "person", text: "Good, how are you?" },
      {
        speaker: "rep",
        text: "Great! My name is [Rep Name] with WolfGrid. We are a door-to-door software built to help real estate teams track, manage, and organize their field prospecting.\n\nDoes your team currently hand out flyers or door knock?",
      },
    ],
    coach:
      "Keep this conversational. The goal is to confirm they do field prospecting before explaining too much.",
    options: [
      { label: "Yes", nextId: "tracking-check" },
      { label: "No", nextId: "no-door-knocking-reason" },
    ],
  },
  {
    id: "no-door-knocking-reason",
    label: "No door knocking",
    kind: "question",
    title: "Ask why they do not door knock",
    say: "Interesting, is there a specific reason why you don't do any doorknocking?",
    lines: [
      {
        speaker: "rep",
        text: "Interesting, is there a specific reason why you don't do any doorknocking?",
      },
    ],
    coach:
      "Keep the tone curious. The goal is to understand the blocker before positioning WolfGrid.",
    options: [
      { label: "Scared / uncomfortable", nextId: "objection-scared" },
      { label: "Does not work", nextId: "objection-does-not-work" },
      { label: "No time", nextId: "objection-no-time" },
      { label: "Repeat and referral", nextId: "objection-repeat-referral" },
      { label: "No system", nextId: "objection-no-system" },
      { label: "Too salesy", nextId: "objection-too-salesy" },
    ],
  },
  {
    id: "objection-scared",
    label: "Scared",
    kind: "objection",
    title: "Scared or uncomfortable",
    say: "People are scared to answer the door.\nYou know what, that makes total sense - most agents feel that way at first. But here's what's interesting: the discomfort you feel is the same discomfort every other agent feels. Which means the ones who push through it own the street. Can I ask - is it more the not knowing what to say, or just the idea of showing up unannounced?",
    lines: [
      { speaker: "person", text: "People are scared to answer the door." },
      {
        speaker: "rep",
        text: "You know what, that makes total sense - most agents feel that way at first. But here's what's interesting: the discomfort you feel is the same discomfort every other agent feels. Which means the ones who push through it own the street. Can I ask - is it more the not knowing what to say, or just the idea of showing up unannounced?",
      },
    ],
    coach:
      "Let them answer. Separate fear of rejection from fear of being unprepared. One is emotional, one is solvable with a tool.",
    options: [
      { label: "Don't know what to say", nextId: "objection-scared-script" },
      { label: "Feels weird showing up", nextId: "objection-scared-unannounced" },
    ],
  },
  {
    id: "objection-scared-script",
    label: "Scared",
    kind: "objection",
    title: "They do not know what to say",
    say: "I don't know what to say.\nThat's exactly what WolfGrid solves. You open the app before you knock and it tells you exactly what to say based on who lives there and where they are in your follow-up sequence. You're never winging it.",
    lines: [
      { speaker: "person", text: "I don't know what to say." },
      {
        speaker: "rep",
        text: "That's exactly what WolfGrid solves. You open the app before you knock and it tells you exactly what to say based on who lives there and where they are in your follow-up sequence. You're never winging it.",
      },
    ],
    coach: "Position WolfGrid as preparation and confidence before the knock.",
    options: [{ label: "Close", nextId: "objection-scared-close" }],
  },
  {
    id: "objection-scared-unannounced",
    label: "Scared",
    kind: "objection",
    title: "Showing up feels weird",
    say: "It just feels weird showing up.\nThe first time always does. But here's the reframe - you're not a stranger selling something. You're the local expert checking in on your neighbourhood. WolfGrid tracks every visit so by the third knock, you're a familiar face. Familiarity is what converts.",
    lines: [
      { speaker: "person", text: "It just feels weird showing up." },
      {
        speaker: "rep",
        text: "The first time always does. But here's the reframe - you're not a stranger selling something. You're the local expert checking in on your neighbourhood. WolfGrid tracks every visit so by the third knock, you're a familiar face. Familiarity is what converts.",
      },
    ],
    coach: "Reframe the visit as local presence, not a cold interruption.",
    options: [{ label: "Close", nextId: "objection-scared-close" }],
  },
  {
    id: "objection-scared-close",
    label: "Scared",
    kind: "close",
    title: "Close the fear objection",
    say: "The agents crushing it in their farm right now felt exactly the same way. The difference is they had a system that made the first ten doors manageable. That's what we built.",
    lines: [
      {
        speaker: "rep",
        text: "The agents crushing it in their farm right now felt exactly the same way. The difference is they had a system that made the first ten doors manageable. That's what we built.",
      },
    ],
    coach: "Bring it back to a manageable first step.",
    options: QUICK_DEMO_CLOSE_OPTIONS,
  },
  {
    id: "objection-does-not-work",
    label: "Does not work",
    kind: "objection",
    title: "They tried it and it did not work",
    say: "I've tried it, it doesn't work.\nI hear that a lot, and I want to dig into it - because there's door knocking, and then there's systematic farm knocking, and they're completely different things. When you tried it, did you have a defined route, a follow-up cadence, and a way to track who you'd already spoken to?",
    lines: [
      { speaker: "person", text: "I've tried it, it doesn't work." },
      {
        speaker: "rep",
        text: "I hear that a lot, and I want to dig into it - because there's door knocking, and then there's systematic farm knocking, and they're completely different things. When you tried it, did you have a defined route, a follow-up cadence, and a way to track who you'd already spoken to?",
      },
    ],
    coach:
      "Most agents tried door knocking once, had a bad experience, and quit. Separate their experience from the method.",
    options: [
      { label: "Knocked randomly", nextId: "objection-does-not-work-random" },
      { label: "Had a system", nextId: "objection-does-not-work-system" },
    ],
  },
  {
    id: "objection-does-not-work-random",
    label: "Does not work",
    kind: "objection",
    title: "They knocked randomly",
    say: "No, I just knocked randomly.\nRight - that's the problem. Random door knocking doesn't work. But knocking the same 200 homes every 60 days with a tracked follow-up sequence? That's how you build 30% market share in a neighbourhood. The agents telling you it doesn't work never had a system. The ones quietly listing every month on their street do.",
    lines: [
      { speaker: "person", text: "No, I just knocked randomly." },
      {
        speaker: "rep",
        text: "Right - that's the problem. Random door knocking doesn't work. But knocking the same 200 homes every 60 days with a tracked follow-up sequence? That's how you build 30% market share in a neighbourhood. The agents telling you it doesn't work never had a system. The ones quietly listing every month on their street do.",
      },
    ],
    coach: "Contrast random activity with repeatable farm ownership.",
    options: [{ label: "Close", nextId: "objection-does-not-work-close" }],
  },
  {
    id: "objection-does-not-work-system",
    label: "Does not work",
    kind: "objection",
    title: "They had a system",
    say: "I had a system and it still didn't work.\nTell me about it - how long did you run it, how often were you knocking, and what were you saying at the door?",
    lines: [
      { speaker: "person", text: "I had a system and it still didn't work." },
      {
        speaker: "rep",
        text: "Tell me about it - how long did you run it, how often were you knocking, and what were you saying at the door?",
      },
    ],
    coach:
      "Listen for the gap. It is usually cadence or script, not the method itself.",
    options: [{ label: "Close", nextId: "objection-does-not-work-close" }],
  },
  {
    id: "objection-does-not-work-close",
    label: "Does not work",
    kind: "close",
    title: "Close the method objection",
    say: "WolfGrid isn't door knocking software. It's a farm ownership system. The knocking is just the touchpoint. The CRM behind it is what turns a street into a territory.",
    lines: [
      {
        speaker: "rep",
        text: "WolfGrid isn't door knocking software. It's a farm ownership system. The knocking is just the touchpoint. The CRM behind it is what turns a street into a territory.",
      },
    ],
    coach: "Anchor the value in system and territory ownership.",
    options: QUICK_DEMO_CLOSE_OPTIONS,
  },
  {
    id: "objection-no-time",
    label: "No time",
    kind: "objection",
    title: "Too busy with existing clients",
    say: "I'm too busy with existing clients.\nTotally fair - you're busy, which means your business is working. Here's my question though: how much of your time right now is going toward generating new business versus serving existing clients?",
    lines: [
      { speaker: "person", text: "I'm too busy with existing clients." },
      {
        speaker: "rep",
        text: "Totally fair - you're busy, which means your business is working. Here's my question though: how much of your time right now is going toward generating new business versus serving existing clients?",
      },
    ],
    coach:
      "Busy agents are usually feast-or-famine. Surface the future risk without making them feel criticised.",
    options: [
      { label: "Serving clients", nextId: "objection-no-time-serving" },
      { label: "No spare time", nextId: "objection-no-time-none" },
    ],
  },
  {
    id: "objection-no-time-serving",
    label: "No time",
    kind: "objection",
    title: "Most time goes to clients",
    say: "Most of my time is serving clients.\nThat's the trap most successful agents fall into. Business is great right now - but what happens in 90 days when the current deals close and nothing's coming in behind them? A farm is the fix. And it doesn't take hours. Ten doors, three days a week. WolfGrid routes you, logs the visit, and tracks follow-ups automatically. We're talking 45 minutes.",
    lines: [
      { speaker: "person", text: "Most of my time is serving clients." },
      {
        speaker: "rep",
        text: "That's the trap most successful agents fall into. Business is great right now - but what happens in 90 days when the current deals close and nothing's coming in behind them? A farm is the fix. And it doesn't take hours. Ten doors, three days a week. WolfGrid routes you, logs the visit, and tracks follow-ups automatically. We're talking 45 minutes.",
      },
    ],
    coach: "Connect time pressure to pipeline risk, then make the action small.",
    options: [{ label: "Close", nextId: "objection-no-time-close" }],
  },
  {
    id: "objection-no-time-none",
    label: "No time",
    kind: "objection",
    title: "They have no spare time",
    say: "I genuinely don't have any spare time.\nWhat if I could show you a way to run a farm in less time than it takes to prospect on the phone? No dialling, no waiting, no voicemails. You walk a route, tap a result, and you're done. Most of our agents fit it in a lunch break.",
    lines: [
      { speaker: "person", text: "I genuinely don't have any spare time." },
      {
        speaker: "rep",
        text: "What if I could show you a way to run a farm in less time than it takes to prospect on the phone? No dialling, no waiting, no voicemails. You walk a route, tap a result, and you're done. Most of our agents fit it in a lunch break.",
      },
    ],
    coach: "Compare the workflow to phone prospecting and lower the perceived lift.",
    options: [{ label: "Close", nextId: "objection-no-time-close" }],
  },
  {
    id: "objection-no-time-close",
    label: "No time",
    kind: "close",
    title: "Close the time objection",
    say: "The goal isn't to add to your plate. It's to replace the most expensive thing you're already doing - chasing cold leads - with something that builds compounding value every single week.",
    lines: [
      {
        speaker: "rep",
        text: "The goal isn't to add to your plate. It's to replace the most expensive thing you're already doing - chasing cold leads - with something that builds compounding value every single week.",
      },
    ],
    coach: "Make WolfGrid feel like replacement, not additional workload.",
    options: QUICK_DEMO_CLOSE_OPTIONS,
  },
  {
    id: "objection-repeat-referral",
    label: "Referral",
    kind: "objection",
    title: "They work off repeat and referral",
    say: "I work off repeat and referral.\nThat's honestly the best position to be in - it means people trust you enough to send business your way. Can I ask, how predictable is that flow month to month? Like, can you forecast your next six months purely from referrals?",
    lines: [
      { speaker: "person", text: "I work off repeat and referral." },
      {
        speaker: "rep",
        text: "That's honestly the best position to be in - it means people trust you enough to send business your way. Can I ask, how predictable is that flow month to month? Like, can you forecast your next six months purely from referrals?",
      },
    ],
    coach:
      "Validate the model, then expose the single point of failure. Do not attack referrals.",
    options: [
      { label: "Pretty predictable", nextId: "objection-repeat-referral-predictable" },
      { label: "Up and down", nextId: "objection-repeat-referral-inconsistent" },
    ],
  },
  {
    id: "objection-repeat-referral-predictable",
    label: "Referral",
    kind: "objection",
    title: "Referrals are predictable",
    say: "Pretty predictable.\nThat's rare - most agents can't say that. Here's what I'd offer though: a farm doesn't replace your referral engine, it runs alongside it. Imagine adding a neighbourhood that generates two to three listings a year on top of what you're already doing. That's not more work - that's leverage.",
    lines: [
      { speaker: "person", text: "Pretty predictable." },
      {
        speaker: "rep",
        text: "That's rare - most agents can't say that. Here's what I'd offer though: a farm doesn't replace your referral engine, it runs alongside it. Imagine adding a neighbourhood that generates two to three listings a year on top of what you're already doing. That's not more work - that's leverage.",
      },
    ],
    coach: "Keep their referral strength intact and position farming as upside.",
    options: [{ label: "Close", nextId: "objection-repeat-referral-close" }],
  },
  {
    id: "objection-repeat-referral-inconsistent",
    label: "Referral",
    kind: "objection",
    title: "Referrals are up and down",
    say: "Honestly it's a bit up and down.\nThat's the thing with referrals - you can't control the timing. A farm fixes that. It's a consistent touchpoint with a defined group of homeowners who start to see you as their agent before they even decide to sell. WolfGrid makes that manageable without it taking over your week.",
    lines: [
      { speaker: "person", text: "Honestly it's a bit up and down." },
      {
        speaker: "rep",
        text: "That's the thing with referrals - you can't control the timing. A farm fixes that. It's a consistent touchpoint with a defined group of homeowners who start to see you as their agent before they even decide to sell. WolfGrid makes that manageable without it taking over your week.",
      },
    ],
    coach: "Tie unpredictability to the need for a controlled channel.",
    options: [{ label: "Close", nextId: "objection-repeat-referral-close" }],
  },
  {
    id: "objection-repeat-referral-close",
    label: "Referral",
    kind: "close",
    title: "Close the referral objection",
    say: "You've built something most agents never build. A farm just puts a geographic fence around it so no one can come in and take those relationships from you.",
    lines: [
      {
        speaker: "rep",
        text: "You've built something most agents never build. A farm just puts a geographic fence around it so no one can come in and take those relationships from you.",
      },
    ],
    coach: "Protect what they already have instead of replacing it.",
    options: QUICK_DEMO_CLOSE_OPTIONS,
  },
  {
    id: "objection-no-system",
    label: "No system",
    kind: "objection",
    title: "No system or farm area",
    say: "I don't have a system or farm area.\nHonestly that's the most common starting point - most agents know they should be farming, they just haven't had a reason to sit down and figure out the system. What's stopped you from setting one up before now?",
    lines: [
      { speaker: "person", text: "I don't have a system or farm area." },
      {
        speaker: "rep",
        text: "Honestly that's the most common starting point - most agents know they should be farming, they just haven't had a reason to sit down and figure out the system. What's stopped you from setting one up before now?",
      },
    ],
    coach:
      "This is the warmest objection. They are not resistant - they are stuck. Listen for time, knowledge, or inertia.",
    options: [
      { label: "Don't know where to start", nextId: "objection-no-system-start" },
      { label: "Haven't gotten around to it", nextId: "objection-no-system-inertia" },
    ],
  },
  {
    id: "objection-no-system-start",
    label: "No system",
    kind: "objection",
    title: "They do not know where to start",
    say: "I don't know where to start.\nThat's exactly what WolfGrid is built for. You pick a neighbourhood - we help you with that too if you need it - and the app builds your farm automatically. It pulls the address data, maps your route, and gives you a knock sequence. You're not figuring anything out. You just show up and follow the app.",
    lines: [
      { speaker: "person", text: "I don't know where to start." },
      {
        speaker: "rep",
        text: "That's exactly what WolfGrid is built for. You pick a neighbourhood - we help you with that too if you need it - and the app builds your farm automatically. It pulls the address data, maps your route, and gives you a knock sequence. You're not figuring anything out. You just show up and follow the app.",
      },
    ],
    coach: "Remove the setup friction and make starting feel simple.",
    options: [{ label: "Close", nextId: "objection-no-system-close" }],
  },
  {
    id: "objection-no-system-inertia",
    label: "No system",
    kind: "objection",
    title: "They have not gotten around to it",
    say: "I haven't gotten around to it.\nHere's what I find - agents who haven't gotten around to it are usually waiting for the right time. There's never a right time. But there is a first door. And once you've knocked it, the system takes over. What would it take to knock your first ten doors this week?",
    lines: [
      { speaker: "person", text: "I haven't gotten around to it." },
      {
        speaker: "rep",
        text: "Here's what I find - agents who haven't gotten around to it are usually waiting for the right time. There's never a right time. But there is a first door. And once you've knocked it, the system takes over. What would it take to knock your first ten doors this week?",
      },
    ],
    coach: "Turn inertia into a concrete first action.",
    options: [{ label: "Close", nextId: "objection-no-system-close" }],
  },
  {
    id: "objection-no-system-close",
    label: "No system",
    kind: "close",
    title: "Close the no-system objection",
    say: "Not having a farm yet is actually an advantage. You get to pick the right neighbourhood instead of inheriting the wrong one. Let's find you the right street.",
    lines: [
      {
        speaker: "rep",
        text: "Not having a farm yet is actually an advantage. You get to pick the right neighbourhood instead of inheriting the wrong one. Let's find you the right street.",
      },
    ],
    coach: "Frame the lack of a system as a clean starting point.",
    options: QUICK_DEMO_CLOSE_OPTIONS,
  },
  {
    id: "objection-too-salesy",
    label: "Too salesy",
    kind: "objection",
    title: "Feels pushy or salesy",
    say: "It feels pushy or salesy.\nI get that completely - nobody wants to feel like they're bothering people. But can I share something that might reframe it? The agents who feel pushy at the door are usually going there to sell. The ones who don't feel pushy are going there to be known. Those are two completely different visits.",
    lines: [
      { speaker: "person", text: "It feels pushy or salesy." },
      {
        speaker: "rep",
        text: "I get that completely - nobody wants to feel like they're bothering people. But can I share something that might reframe it? The agents who feel pushy at the door are usually going there to sell. The ones who don't feel pushy are going there to be known. Those are two completely different visits.",
      },
    ],
    coach:
      "This is about identity, not strategy. Give them a new identity: the neighbourhood expert, not the door-to-door salesperson.",
    options: [
      { label: "Do not want to bother people", nextId: "objection-too-salesy-bother" },
      { label: "Feels desperate", nextId: "objection-too-salesy-status" },
    ],
  },
  {
    id: "objection-too-salesy-bother",
    label: "Too salesy",
    kind: "objection",
    title: "They do not want to bother people",
    say: "I just don't want to bother people.\nYou're not bothering them - you're introducing yourself as the person who knows their street better than anyone. No pitch. No close. Just a face, a name, and a reason to remember you. WolfGrid even gives you conversation starters based on local market data so you're always showing up with something valuable.",
    lines: [
      { speaker: "person", text: "I just don't want to bother people." },
      {
        speaker: "rep",
        text: "You're not bothering them - you're introducing yourself as the person who knows their street better than anyone. No pitch. No close. Just a face, a name, and a reason to remember you. WolfGrid even gives you conversation starters based on local market data so you're always showing up with something valuable.",
      },
    ],
    coach: "Make the interaction useful and low-pressure.",
    options: [{ label: "Close", nextId: "objection-too-salesy-close" }],
  },
  {
    id: "objection-too-salesy-status",
    label: "Too salesy",
    kind: "objection",
    title: "It feels desperate",
    say: "It feels desperate or low status.\nHere's the reframe: cold calling feels desperate. Showing up in person in a neighbourhood you own feels like authority. The agents with the highest status in any market are the ones whose faces are everywhere in that area. Presence is positioning.",
    lines: [
      { speaker: "person", text: "It feels desperate or low status." },
      {
        speaker: "rep",
        text: "Here's the reframe: cold calling feels desperate. Showing up in person in a neighbourhood you own feels like authority. The agents with the highest status in any market are the ones whose faces are everywhere in that area. Presence is positioning.",
      },
    ],
    coach: "Move from low-status selling to high-status local authority.",
    options: [{ label: "Close", nextId: "objection-too-salesy-close" }],
  },
  {
    id: "objection-too-salesy-close",
    label: "Too salesy",
    kind: "close",
    title: "Close the salesy objection",
    say: "Nobody buys at the door. The door is just the introduction. The sale happens six months later when they remember your face and your name is the first one they call. WolfGrid tracks every single one of those introductions so you never lose the thread.",
    lines: [
      {
        speaker: "rep",
        text: "Nobody buys at the door. The door is just the introduction. The sale happens six months later when they remember your face and your name is the first one they call. WolfGrid tracks every single one of those introductions so you never lose the thread.",
      },
    ],
    coach: "Make the door a relationship start, not a sales moment.",
    options: QUICK_DEMO_CLOSE_OPTIONS,
  },
  {
    id: "tracking-check",
    label: "Tracking",
    kind: "question",
    title: "Ask how they track it",
    say: "That is great. WolfGrid is designed specifically for team leaders who want better visibility into what their agents are doing in the field.\nAre you currently tracking your door-to-door prospecting in any way?",
    lines: [
      {
        speaker: "rep",
        text: "That is great. WolfGrid is designed specifically for team leaders who want better visibility into what their agents are doing in the field.\n\nAre you currently tracking your door-to-door prospecting in any way?",
      },
    ],
    coach:
      "Listen for whether they use spreadsheets, notes, another software, or nothing at all.",
    options: [
      { label: "Yes, tracking somehow", nextId: "tracking-yes" },
      { label: "No tracking", nextId: "pain-match" },
    ],
  },
  {
    id: "tracking-yes",
    label: "Tracking",
    kind: "question",
    title: "Ask what tracking looks like",
    say: "Yes, we track it somehow.\nNice - what does that look like? Like are you using a spreadsheet, notes on your phone, another software, or are you not really tracking it yet?",
    lines: [
      { speaker: "person", text: "Yes, we track it somehow." },
      {
        speaker: "rep",
        text: "Nice - what does that look like? Like are you using a spreadsheet, notes on your phone, another software, or are you not really tracking it yet?",
      },
    ],
    coach:
      "Let them describe it. The messier it sounds, the better. Do not judge or rush to pitch. Let them feel the gap between what they are doing and what is possible.",
    options: [
      { label: "Spreadsheet / notes / phone", nextId: "tracking-manual" },
      { label: "Another software", nextId: "tracking-crm" },
      { label: "No tracking", nextId: "pain-match" },
    ],
  },
  {
    id: "tracking-manual",
    label: "Tracking",
    kind: "question",
    title: "Manual tracking follow-up",
    say: "Spreadsheet, notes, or phone.\nHonestly, you're 90% there. Recognizing the importance of tracking field effort is literally what our company is founded on.\nIf I could show you a system that automatically tracks advanced field data and creates a weekly report for your team, would you be open to checking it out?",
    lines: [
      { speaker: "person", text: "Spreadsheet, notes, or phone." },
      {
        speaker: "rep",
        text: "Honestly, you're 90% there. Recognizing the importance of tracking field effort is literally what our company is founded on.\n\nIf I could show you a system that automatically tracks advanced field data and creates a weekly report for your team, would you be open to checking it out?",
      },
    ],
    coach:
      "Validate that they already understand the tracking problem, then make the ask about seeing the system.",
    options: QUICK_DEMO_CLOSE_OPTIONS,
  },
  {
    id: "tracking-manual-close",
    label: "Tracking",
    kind: "close",
    title: "Close the manual tracking gap",
    say: "That's exactly the gap WolfGrid closes. Every door is logged in two taps, your follow-up sequence runs automatically, and you can see your whole farm on a live map. No spreadsheet, no notes, nothing lost.",
    lines: [
      {
        speaker: "rep",
        text: "That's exactly the gap WolfGrid closes. Every door is logged in two taps, your follow-up sequence runs automatically, and you can see your whole farm on a live map. No spreadsheet, no notes, nothing lost.",
      },
    ],
    coach: "Tie the pain directly to speed, automation, and visibility.",
    options: QUICK_DEMO_CLOSE_OPTIONS,
  },
  {
    id: "tracking-crm",
    label: "Tracking",
    kind: "question",
    title: "Software tracking follow-up",
    say: "Another software.\nWhich one? And does it have a map view, route history, a knock sequence, and follow-up reminders for each door?",
    lines: [
      { speaker: "person", text: "Another software." },
      {
        speaker: "rep",
        text: "Which one? And does it have a map view, route history, a knock sequence, and follow-up reminders for each door?",
      },
    ],
    coach: "Stay curious. Let them explain the system, then look for the missing field layer.",
    options: [{ label: "Position WolfGrid", nextId: "tracking-crm-close" }],
  },
  {
    id: "tracking-crm-close",
    label: "Tracking",
    kind: "close",
    title: "Close the software tracking gap",
    say: "That makes sense. WolfGrid can sit beside whatever you're using and handle the field layer: mapped territory, door outcomes, agent activity, and follow-up prompts before it becomes an actual lead.",
    lines: [
      {
        speaker: "rep",
        text: "That makes sense. WolfGrid can sit beside whatever you're using and handle the field layer: mapped territory, door outcomes, agent activity, and follow-up prompts before it becomes an actual lead.",
      },
    ],
    coach:
      "Position WolfGrid as the missing field-prospecting layer instead of a replacement for tools they already like.",
    options: QUICK_DEMO_CLOSE_OPTIONS,
  },
  {
    id: "pain-match",
    label: "Pain",
    kind: "question",
    title: "Connect the pain",
    say: "Totally fair. A lot of teams are in the same position.\nMost teams are putting in effort door knocking or handing out flyers, but they do not really have clear data on what is working, where their agents have been, or which leads need follow-up.\nThat is exactly why we built WolfGrid.\nIt gives team leaders real numbers on field activity, agent performance, territories covered, and leads generated.\nIf I could show you how your team could track all of that in one place, would that be worth taking a quick look at?\nYes.",
    lines: [
      {
        speaker: "rep",
        text: "Totally fair. A lot of teams are in the same position.\n\nMost teams are putting in effort door knocking or handing out flyers, but they do not really have clear data on what is working, where their agents have been, or which leads need follow-up.\n\nThat is exactly why we built WolfGrid.\n\nIt gives team leaders real numbers on field activity, agent performance, territories covered, and leads generated.\n\nIf I could show you how your team could track all of that in one place, would that be worth taking a quick look at?",
      },
      { speaker: "person", text: "Yes." },
    ],
    coach:
      "Make this about their current visibility gap, not a long feature list.",
    options: QUICK_DEMO_CLOSE_OPTIONS,
  },
  {
    id: "fallback-not-convinced",
    label: "Hesitation",
    kind: "question",
    title: "Still not convinced",
    say: "Fair enough - I'm not trying to push you into something that's not right. Can I ask one thing though: is it the idea of farming in general that doesn't sit right, or just doing it with us?",
    lines: [
      {
        speaker: "rep",
        text: "Fair enough - I'm not trying to push you into something that's not right.\n\nCan I ask one thing though: is it the idea of farming in general that doesn't sit right, or just doing it with us?",
      },
    ],
    coach:
      "This splits 'not interested in farming' from 'not interested in WolfGrid specifically.' Do not close the call without learning which one it is.",
    options: [
      { label: "Farming is not for me", nextId: "fallback-not-convinced-farming" },
      { label: "Not sure about WolfGrid / timing", nextId: "fallback-not-convinced-flyr" },
      { label: "Asks price", nextId: "price-objection" },
    ],
  },
  {
    id: "fallback-not-convinced-farming",
    label: "Hesitation",
    kind: "objection",
    title: "Farming is not for them",
    say: "Farming in general isn't for me.\nTotally get it - it's not for everyone, and forcing it usually backfires. Before I leave it there, would you be open to a quick 90-second demo just to see if it's for you? If it doesn't click in 90 seconds, no worries at all.",
    lines: [
      { speaker: "person", text: "Farming in general isn't for me." },
      {
        speaker: "rep",
        text: "Totally get it - it's not for everyone, and forcing it usually backfires.\n\nBefore I leave it there, would you be open to a quick 90-second demo just to see if it's for you? If it doesn't click in 90 seconds, no worries at all.",
      },
    ],
    coach:
      "Make the ask smaller and low-pressure: a quick demo to let them decide, not a calendar commitment.",
    options: [{ label: "Open to quick demo", nextId: "demo-send" }],
  },
  {
    id: "fallback-not-convinced-flyr",
    label: "Hesitation",
    kind: "close",
    title: "Unsure about WolfGrid or timing",
    say: "Just not sure about doing it with you right now.\nThat's fair, and honestly a smart way to think about it. What would actually need to be true for this to make sense - timing, proof it works, seeing the app first?\nRather than trying to book you into anything now, I can email the short demo video so you can check it out on your own time.",
    lines: [
      { speaker: "person", text: "Just not sure about doing it with you right now." },
      {
        speaker: "rep",
        text: "That's fair, and honestly a smart way to think about it.\n\nWhat would actually need to be true for this to make sense - timing, proof it works, seeing the app first?\n\nRather than trying to book you into anything now, I can email the short demo video so you can check it out on your own time.",
      },
    ],
    coach:
      "Listen before the ask. The second ask must be smaller than the one they declined: video, one-pager, or check-in date.",
    options: [
      { label: "Email video", nextId: "demo-send" },
      { label: "Send resource instead", nextId: "fallback-soft-nurture" },
    ],
  },
  {
    id: "fallback-soft-nurture",
    label: "Nurture",
    kind: "close",
    title: "Soft nurture exit",
    say: "No problem. I will send the resource over and leave it there. No calendar invite, no pressure - just something useful if farming becomes relevant later.",
    lines: [
      {
        speaker: "rep",
        text: "No problem. I will send the resource over and leave it there.\n\nNo calendar invite, no pressure - just something useful if farming becomes relevant later.",
      },
    ],
    coach:
      "Soft exit. Mark the lead as nurture, not lost, and do not create a calendar ask.",
    options: [{ label: "Mark nurture", nextId: "soft-nurture-exit" }],
  },
  {
    id: "soft-nurture-exit",
    label: "Nurture",
    kind: "done",
    title: "Nurture complete",
    say: "Send the farm ownership resource, mark the lead as nurture, and set a light future check-in if appropriate.",
    lines: [
      {
        speaker: "rep",
        text: "Send the farm ownership resource, mark the lead as nurture, and set a light future check-in if appropriate.",
      },
    ],
    coach: "This is a soft exit. Do not count it as a lost lead.",
    options: [{ label: "Start again", nextId: "opening" }],
  },
  {
    id: "price-objection",
    label: "Price",
    kind: "question",
    title: "Ask about current spend",
    say: "Good question - before I throw a number at you, can I ask what you're currently spending on lead gen or marketing in this farm-sized area? Just so the number means something.",
    lines: [
      {
        speaker: "rep",
        text: "Good question - before I throw a number at you, can I ask what you're currently spending on lead gen or marketing in this farm-sized area? Just so the number means something.",
      },
    ],
    coach:
      "Never quote price in a vacuum. Anchor it against what they already spend on lead gen, ISAs, paid ads, or staying visible.",
    options: [
      { label: "Do not track spend / not much", nextId: "price-low-spend" },
      { label: "Spend a fair amount already", nextId: "price-existing-spend" },
    ],
  },
  {
    id: "price-low-spend",
    label: "Price",
    kind: "objection",
    title: "They do not track spend",
    say: "I don't really track that, or not much.\nThat's actually common - most agents don't realize how much unattributed spend goes into staying visible. WolfGrid is a flat monthly cost that replaces a lot of that guesswork with something you can point to: doors knocked, contacts logged, listings sourced from the farm.",
    lines: [
      { speaker: "person", text: "I don't really track that, or not much." },
      {
        speaker: "rep",
        text: "That's actually common - most agents don't realize how much unattributed spend goes into staying visible.\n\nWolfGrid is a flat monthly cost that replaces a lot of that guesswork with something you can point to: doors knocked, contacts logged, listings sourced from the farm.",
      },
    ],
    coach:
      "Make price feel like replacing invisible spend with measurable activity.",
    options: [{ label: "Email pricing", nextId: "price-email-close" }],
  },
  {
    id: "price-existing-spend",
    label: "Price",
    kind: "objection",
    title: "They already spend on lead gen",
    say: "I spend a fair amount already.\nThen this is probably going to feel cheap by comparison. WolfGrid starts at $30 USD per user per month, which is about $40 CAD.\nIf you're already spending on lead gen, the question is really whether this gives you cleaner tracking and better follow-up for less than what you're already paying.",
    lines: [
      { speaker: "person", text: "I spend a fair amount already." },
      {
        speaker: "rep",
        text: "Then this is probably going to feel cheap by comparison.\n\nWolfGrid starts at $30 USD per user per month, which is about $40 CAD.\n\nIf you're already spending on lead gen, the question is really whether this gives you cleaner tracking and better follow-up for less than what you're already paying.",
      },
    ],
    coach:
      "Keep price relative to what they already pay for lead generation and visibility.",
    options: [{ label: "Email pricing", nextId: "price-email-close" }],
  },
  {
    id: "price-email-close",
    label: "Price",
    kind: "close",
    title: "Email pricing breakdown",
    say: "I can email you the pricing breakdown so you can see it next to what you're already spending. No pressure to decide on this call.",
    lines: [
      {
        speaker: "rep",
        text: "I can email you the pricing breakdown so you can see it next to what you're already spending.\n\nNo pressure to decide on this call.",
      },
    ],
    coach:
      "Email the pricing breakdown and set a follow-up. Do not force a decision on the call.",
    options: [{ label: "Pricing email confirmed", nextId: "done" }],
  },
  {
    id: "demo-send",
    label: "Demo",
    kind: "close",
    title: "Ask to send demo",
    say: "Amazing. What is the best email to send you a quick 90-second video showing how the software works?\nYes.",
    lines: [
      {
        speaker: "rep",
        text: "Amazing. What is the best email to send you a quick 90-second video showing how the software works?",
      },
      { speaker: "person", text: "Yes." },
    ],
    coach: "Confirm the email and send it immediately after the call.",
    options: [{ label: "Email confirmed", nextId: "trial-close" }],
  },
  {
    id: "trial-close",
    label: "Close",
    kind: "close",
    title: "Send included campaign access",
    say: "Perfect. I will email that over now.\nI will also include access to one included campaign so you can test it out with your team.\nIf you have any questions after watching it, feel free to reach out anytime.",
    lines: [
      {
        speaker: "rep",
        text: "Perfect. I will email that over now.\n\nI will also include access to one included campaign so you can test it out with your team.\n\nIf you have any questions after watching it, feel free to reach out anytime.",
      },
    ],
    coach:
      "End cleanly, then email the video and included campaign link before moving to the next lead.",
    options: [{ label: "Done", nextId: "done" }],
  },
  {
    id: "done",
    label: "Done",
    kind: "done",
    title: "Call complete",
    say: "Log the outcome, email the 90-second video, include campaign access, and set a follow-up.",
    lines: [
      {
        speaker: "rep",
        text: "Log the outcome, email the 90-second video, include campaign access, and set a follow-up.",
      },
    ],
    coach: "The call outcome should be demo emailed with included campaign access.",
    options: [{ label: "Start again", nextId: "opening" }],
  },
];

export const REAL_ESTATE_QUICK_DEMO_SCRIPT_BODY = encodeScriptFlowBody(
  REAL_ESTATE_QUICK_DEMO_SCRIPT_FLOW,
);

export const REAL_ESTATE_INDIVIDUAL_AGENT_ENCODED_SCRIPT_BODY =
  encodeScriptFlowBody(REAL_ESTATE_INDIVIDUAL_AGENT_SCRIPT_FLOW);

export const INDIVIDUAL_REALTOR_LISTING_LEVERAGE_ENCODED_SCRIPT_BODY =
  encodeScriptFlowBody(INDIVIDUAL_REALTOR_LISTING_LEVERAGE_SCRIPT_FLOW);

export const BUILT_IN_SCRIPT_DEFINITIONS = [
  {
    id: STARTER_SCRIPT_ID,
    name: STARTER_SCRIPT_NAME,
    body: STARTER_SCRIPT_BODY,
    flow: STARTER_SCRIPT_FLOW,
  },
  {
    id: REAL_ESTATE_QUICK_DEMO_SCRIPT_ID,
    name: REAL_ESTATE_QUICK_DEMO_SCRIPT_NAME,
    body: REAL_ESTATE_QUICK_DEMO_SCRIPT_BODY,
    flow: REAL_ESTATE_QUICK_DEMO_SCRIPT_FLOW,
  },
  {
    id: REAL_ESTATE_INDIVIDUAL_AGENT_SCRIPT_ID,
    name: REAL_ESTATE_INDIVIDUAL_AGENT_SCRIPT_NAME,
    body: REAL_ESTATE_INDIVIDUAL_AGENT_ENCODED_SCRIPT_BODY,
    flow: REAL_ESTATE_INDIVIDUAL_AGENT_SCRIPT_FLOW,
  },
  {
    id: INDIVIDUAL_REALTOR_LISTING_LEVERAGE_SCRIPT_ID,
    name: INDIVIDUAL_REALTOR_LISTING_LEVERAGE_SCRIPT_NAME,
    body: INDIVIDUAL_REALTOR_LISTING_LEVERAGE_ENCODED_SCRIPT_BODY,
    flow: INDIVIDUAL_REALTOR_LISTING_LEVERAGE_SCRIPT_FLOW,
  },
  {
    id: INDIVIDUAL_REALTOR_LISTING_LEVERAGE_V2_SCRIPT_ID,
    name: INDIVIDUAL_REALTOR_LISTING_LEVERAGE_V2_SCRIPT_NAME,
    body: INDIVIDUAL_REALTOR_LISTING_LEVERAGE_ENCODED_SCRIPT_BODY,
    flow: INDIVIDUAL_REALTOR_LISTING_LEVERAGE_SCRIPT_FLOW,
  },
] as const;

export function getBuiltInScriptById(scriptId: string) {
  return (
    BUILT_IN_SCRIPT_DEFINITIONS.find((script) => script.id === scriptId) ?? null
  );
}

export function getBuiltInScriptByName(name: string) {
  return (
    BUILT_IN_SCRIPT_DEFINITIONS.find((script) => script.name === name) ?? null
  );
}

export function upgradeBuiltInScriptFlow(
  scriptName: string,
  flow: StarterScriptFlowNode[] | null,
): StarterScriptFlowNode[] | null {
  if (
    (scriptName === INDIVIDUAL_REALTOR_LISTING_LEVERAGE_SCRIPT_NAME ||
      scriptName === INDIVIDUAL_REALTOR_LISTING_LEVERAGE_V2_SCRIPT_NAME) &&
    flow
  ) {
    const currentNodeById = new Map(
      INDIVIDUAL_REALTOR_LISTING_LEVERAGE_SCRIPT_FLOW.map((node) => [
        node.id,
        node,
      ]),
    );

    const upgradedFlow = flow
      .filter((node) => node.id !== "interested-demo-ask")
      .map((node) => {
        if (node.id === "opener") {
          return {
            ...node,
            options: [
              { label: "Not interested", nextId: "not-interested" },
              { label: "Dont doorknock", nextId: "door-knock-objection" },
              { label: "FLYERS", nextId: "flyers-response" },
              { label: "SOCIAL MEDIA", nextId: "social-media-response" },
              { label: "DOORKNOCK", nextId: "doorknock-response" },
            ],
          };
        }

        if (
          node.id === "not-interested" ||
          node.id === "busy" ||
          node.id === "flyers-response" ||
          node.id === "social-media-response" ||
          node.id === "doorknock-response" ||
          node.id === "priority-objection" ||
          node.id === "door-knock-objection" ||
          node.id === "interrupting-homeowners-objection"
        ) {
          return currentNodeById.get(node.id) ?? node;
        }

        if (node.id !== "value-statement") return node;
        return {
          ...node,
          options: node.options.filter(
            (option) =>
              option.nextId !== "qualifier" &&
              option.nextId !== "not-interested" &&
              option.label !== "Ask qualifier" &&
              option.label !== "Not interested",
          ),
        };
      });

    const appendAfter = (
      nodes: StarterScriptFlowNode[],
      anchorId: string,
      nodeToAdd: StarterScriptFlowNode | undefined,
    ) => {
      if (!nodeToAdd || nodes.some((node) => node.id === nodeToAdd.id)) {
        return nodes;
      }
      const anchorIndex = nodes.findIndex((node) => node.id === anchorId);
      if (anchorIndex === -1) return [...nodes, nodeToAdd];
      return [
        ...nodes.slice(0, anchorIndex + 1),
        nodeToAdd,
        ...nodes.slice(anchorIndex + 1),
      ];
    };

    const withOpenerMethodRoutes = [
      "doorknock-response",
      "social-media-response",
      "flyers-response",
    ].reduce(
      (nodes, nodeId) =>
        appendAfter(nodes, "opener", currentNodeById.get(nodeId)),
      upgradedFlow,
    );

    const withDoorKnockObjection = appendAfter(
      withOpenerMethodRoutes,
      "not-interested",
      currentNodeById.get("door-knock-objection"),
    );

    return appendAfter(
      withDoorKnockObjection,
      "door-knock-objection",
      currentNodeById.get("interrupting-homeowners-objection"),
    );
  }

  if (scriptName !== REAL_ESTATE_QUICK_DEMO_SCRIPT_NAME || !flow) return flow;

  const isCurrentTrackingNode = (node: StarterScriptFlowNode) =>
    node.id.startsWith("tracking-") || node.id === "pain-match";
  const isUniversalFallbackNode = (node: StarterScriptFlowNode) =>
    node.id.startsWith("fallback-") ||
    node.id.startsWith("price-") ||
    node.id === "soft-nurture-exit";

  const flowWithoutOpeningConfirmation = flow.map((node) => {
    if (node.id !== "opening" || !node.lines?.length) return node;

    const lines = node.lines.filter((line, index) => {
      const isTrailingYes =
        index === node.lines!.length - 1 &&
        line.speaker === "person" &&
        /^yes\.?$/i.test(line.text.trim());
      return !isTrailingYes;
    });

    if (lines.length === node.lines.length) return node;

    const say = lines
      .map((line) => line.text.trim())
      .filter(Boolean)
      .join("\n");

    return {
      ...node,
      say: say || node.say,
      lines: lines.length ? lines : undefined,
    };
  });

  const hasNoDoorKnockingNode = flow.some(
    (node) => node.id === "no-door-knocking-reason",
  );
  const noDoorKnockingNode = REAL_ESTATE_QUICK_DEMO_SCRIPT_FLOW.find(
    (node) => node.id === "no-door-knocking-reason",
  );
  if (!noDoorKnockingNode) return flowWithoutOpeningConfirmation;

  const flowWithObjectionOptions = flowWithoutOpeningConfirmation.map((node) => {
    if (node.id !== "no-door-knocking-reason") return node;
    return {
      ...node,
      options: noDoorKnockingNode.options,
    };
  });

  const currentObjectionNodes = new Map(
    REAL_ESTATE_QUICK_DEMO_SCRIPT_FLOW.filter((node) =>
      node.id.startsWith("objection-"),
    ).map((node) => [node.id, node]),
  );
  const currentTrackingNodes = new Map(
    REAL_ESTATE_QUICK_DEMO_SCRIPT_FLOW.filter(isCurrentTrackingNode).map(
      (node) => [node.id, node],
    ),
  );
  const currentUniversalFallbackNodes = new Map(
    REAL_ESTATE_QUICK_DEMO_SCRIPT_FLOW.filter(isUniversalFallbackNode).map(
      (node) => [node.id, node],
    ),
  );
  const currentDemoCloseNodes = new Map(
    REAL_ESTATE_QUICK_DEMO_SCRIPT_FLOW.filter((node) =>
      ["demo-send", "trial-close", "done"].includes(node.id),
    ).map((node) => [node.id, node]),
  );
  const flowWithCurrentNodes = flowWithObjectionOptions.map(
    (node) =>
      currentObjectionNodes.get(node.id) ??
      currentTrackingNodes.get(node.id) ??
      currentUniversalFallbackNodes.get(node.id) ??
      currentDemoCloseNodes.get(node.id) ??
      node,
  );

  let upgradedFlow = flowWithCurrentNodes.map((node) => {
    if (node.id !== "opening") return node;

    const options = node.options
      .filter((option) => option.nextId !== "price-objection")
      .map((option) =>
        option.nextId === "tracking-check" ? { ...option, label: "Yes" } : option,
      );
    if (!options.some((option) => option.nextId === "no-door-knocking-reason")) {
      options.push({ label: "No", nextId: "no-door-knocking-reason" });
    }

    return {
      ...node,
      options,
    };
  });

  if (!hasNoDoorKnockingNode) {
    const openingIndex = upgradedFlow.findIndex((node) => node.id === "opening");
    upgradedFlow =
      openingIndex === -1
        ? [...upgradedFlow, noDoorKnockingNode]
        : [
            ...upgradedFlow.slice(0, openingIndex + 1),
            noDoorKnockingNode,
            ...upgradedFlow.slice(openingIndex + 1),
          ];
  }

  const currentObjectionNodeList = REAL_ESTATE_QUICK_DEMO_SCRIPT_FLOW.filter(
    (node) => node.id.startsWith("objection-"),
  );
  if (currentObjectionNodeList.length === 0) return upgradedFlow;

  const flowWithoutObjectionNodes = upgradedFlow.filter(
    (node) => !node.id.startsWith("objection-") && !isUniversalFallbackNode(node),
  );
  const currentTrackingNodeList =
    REAL_ESTATE_QUICK_DEMO_SCRIPT_FLOW.filter(isCurrentTrackingNode);
  const currentUniversalFallbackNodeList =
    REAL_ESTATE_QUICK_DEMO_SCRIPT_FLOW.filter(isUniversalFallbackNode);
  const trackingIndex = flowWithoutObjectionNodes.findIndex(
    (node) => node.id === "tracking-check",
  );
  const flowWithCurrentTrackingNodes =
    trackingIndex === -1
      ? [...flowWithoutObjectionNodes, ...currentTrackingNodeList]
      : [
          ...flowWithoutObjectionNodes
            .slice(0, trackingIndex)
            .filter((node) => !isCurrentTrackingNode(node)),
          ...currentTrackingNodeList,
          ...flowWithoutObjectionNodes
            .slice(trackingIndex + 1)
            .filter((node) => !isCurrentTrackingNode(node)),
        ];

  const demoIndex = flowWithCurrentTrackingNodes.findIndex(
    (node) => node.id === "demo-send",
  );
  const flowWithUniversalFallbackNodes =
    demoIndex === -1
      ? [...flowWithCurrentTrackingNodes, ...currentUniversalFallbackNodeList]
      : [
          ...flowWithCurrentTrackingNodes.slice(0, demoIndex),
          ...currentUniversalFallbackNodeList,
          ...flowWithCurrentTrackingNodes.slice(demoIndex),
        ];

  const noDoorKnockingIndex = flowWithUniversalFallbackNodes.findIndex(
    (node) => node.id === "no-door-knocking-reason",
  );
  if (noDoorKnockingIndex === -1) {
    return [...flowWithUniversalFallbackNodes, ...currentObjectionNodeList];
  }

  return [
    ...flowWithUniversalFallbackNodes.slice(0, noDoorKnockingIndex + 1),
    ...currentObjectionNodeList,
    ...flowWithUniversalFallbackNodes.slice(noDoorKnockingIndex + 1),
  ];
}
