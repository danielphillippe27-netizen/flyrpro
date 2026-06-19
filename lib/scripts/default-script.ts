export const STARTER_SCRIPT_NAME = "FLYR Sales Call Flow";
export const STARTER_SCRIPT_ID = "starter-flyr-sales-call-flow";
export const REAL_ESTATE_QUICK_DEMO_SCRIPT_NAME =
  "Real Estate Teams - quick demo";
export const REAL_ESTATE_QUICK_DEMO_SCRIPT_ID = "real-estate-teams-quick-demo";

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
    say: "Hey [Name], it's [Rep Name] with FLYR. Did I catch you with 30 seconds?",
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
    say: "FLYR helps real estate team leads track door knocking, agent activity, and leads from the field.",
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
    say: "No worries. I will be quick. FLYR helps real estate team leads track door knocking, agent activity, and leads from the field. Would it be okay if I emailed you a 90-second demo?",
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
    say: "That's exactly why we built FLYR. It gives team leads a live map of agent activity, completed doors, territory coverage, leads, and follow-ups in one place.",
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
    say: "Makes sense. Most teams have some kind of system. FLYR is built specifically for real estate field prospecting, so it is more visual and team-focused than spreadsheets or scattered notes.",
    coach:
      "Respect what they already have. Position FLYR as focused, visual, and team-based.",
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
    say: "Totally. A lot of tools are general canvassing platforms. FLYR is focused on real estate teams: territories, agent accountability, neighbourhood coverage, and lead follow-up.",
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
    say: "FLYR is currently available with early access pricing. Teams can start at $30 USD per user/month, which is about $40 CAD. If FLYR helps your team create even one extra deal, it more than pays for itself.",
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
    say: "The easiest next step is 10 minutes where I can show you how FLYR would work for your team. Does [Time 1] or [Time 2] work better?",
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
    say: "Got it. Sounds like this may not be a fit right now. If you ever add field prospecting, FLYR could help track it.",
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

export const STARTER_SCRIPT_BODY = `FLYR Sales Call Flow

START:
Hey [Name], it's [Rep Name] with FLYR. Did I catch you with 30 seconds?

QUALIFY:
Do you have agents on your team doing any door knocking, flyer drops, open house follow-up, or neighbourhood prospecting?

TRACKING QUESTION:
Are you currently tracking which doors were hit, which agents are active, and what leads came from the field?

PAIN MATCH:
If manual or not really:
That's exactly why we built FLYR. It gives team leads a live map of agent activity, completed doors, territory coverage, leads, and follow-ups in one place.

If they already track it:
Makes sense. Most teams have some kind of system. FLYR is built specifically for real estate field prospecting, so it is more visual and team-focused than spreadsheets or scattered notes.

If they use another tool:
Totally. A lot of tools are general canvassing platforms. FLYR is focused on real estate teams: territories, agent accountability, neighbourhood coverage, and lead follow-up.

MICRO-CLOSE:
Would it be okay if I emailed you a 90-second demo? You'll know pretty quickly if it makes sense for your team.

REP RULES:
1. Do not explain every feature.
2. The first call is only to qualify and send the demo.
3. Do not argue.
4. Question first, value second.
5. Always end with a next step: send demo, book follow-up, call later, or mark not interested.`;

export const REAL_ESTATE_QUICK_DEMO_SCRIPT_FLOW: StarterScriptFlowNode[] = [
  {
    id: "opening",
    label: "Opening",
    kind: "start",
    title: "Warm opener",
    say: "Hey [Name], how are you today?\nGood, how are you?\nGreat! My name is [Rep Name] with FLYR. We are a door-to-door software built to help real estate teams track, manage, and organize their field prospecting.\nDoes your team currently hand out flyers or door knock?",
    lines: [
      { speaker: "rep", text: "Hey [Name], how are you today?" },
      { speaker: "person", text: "Good, how are you?" },
      {
        speaker: "rep",
        text: "Great! My name is [Rep Name] with FLYR. We are a door-to-door software built to help real estate teams track, manage, and organize their field prospecting.\n\nDoes your team currently hand out flyers or door knock?",
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
      "Keep the tone curious. The goal is to understand the blocker before positioning FLYR.",
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
    say: "I don't know what to say.\nThat's exactly what FLYR solves. You open the app before you knock and it tells you exactly what to say based on who lives there and where they are in your follow-up sequence. You're never winging it.",
    lines: [
      { speaker: "person", text: "I don't know what to say." },
      {
        speaker: "rep",
        text: "That's exactly what FLYR solves. You open the app before you knock and it tells you exactly what to say based on who lives there and where they are in your follow-up sequence. You're never winging it.",
      },
    ],
    coach: "Position FLYR as preparation and confidence before the knock.",
    options: [{ label: "Close", nextId: "objection-scared-close" }],
  },
  {
    id: "objection-scared-unannounced",
    label: "Scared",
    kind: "objection",
    title: "Showing up feels weird",
    say: "It just feels weird showing up.\nThe first time always does. But here's the reframe - you're not a stranger selling something. You're the local expert checking in on your neighbourhood. FLYR tracks every visit so by the third knock, you're a familiar face. Familiarity is what converts.",
    lines: [
      { speaker: "person", text: "It just feels weird showing up." },
      {
        speaker: "rep",
        text: "The first time always does. But here's the reframe - you're not a stranger selling something. You're the local expert checking in on your neighbourhood. FLYR tracks every visit so by the third knock, you're a familiar face. Familiarity is what converts.",
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
    say: "FLYR isn't door knocking software. It's a farm ownership system. The knocking is just the touchpoint. The CRM behind it is what turns a street into a territory.",
    lines: [
      {
        speaker: "rep",
        text: "FLYR isn't door knocking software. It's a farm ownership system. The knocking is just the touchpoint. The CRM behind it is what turns a street into a territory.",
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
    say: "Most of my time is serving clients.\nThat's the trap most successful agents fall into. Business is great right now - but what happens in 90 days when the current deals close and nothing's coming in behind them? A farm is the fix. And it doesn't take hours. Ten doors, three days a week. FLYR routes you, logs the visit, and tracks follow-ups automatically. We're talking 45 minutes.",
    lines: [
      { speaker: "person", text: "Most of my time is serving clients." },
      {
        speaker: "rep",
        text: "That's the trap most successful agents fall into. Business is great right now - but what happens in 90 days when the current deals close and nothing's coming in behind them? A farm is the fix. And it doesn't take hours. Ten doors, three days a week. FLYR routes you, logs the visit, and tracks follow-ups automatically. We're talking 45 minutes.",
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
    coach: "Make FLYR feel like replacement, not additional workload.",
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
    say: "Honestly it's a bit up and down.\nThat's the thing with referrals - you can't control the timing. A farm fixes that. It's a consistent touchpoint with a defined group of homeowners who start to see you as their agent before they even decide to sell. FLYR makes that manageable without it taking over your week.",
    lines: [
      { speaker: "person", text: "Honestly it's a bit up and down." },
      {
        speaker: "rep",
        text: "That's the thing with referrals - you can't control the timing. A farm fixes that. It's a consistent touchpoint with a defined group of homeowners who start to see you as their agent before they even decide to sell. FLYR makes that manageable without it taking over your week.",
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
    say: "I don't know where to start.\nThat's exactly what FLYR is built for. You pick a neighbourhood - we help you with that too if you need it - and the app builds your farm automatically. It pulls the address data, maps your route, and gives you a knock sequence. You're not figuring anything out. You just show up and follow the app.",
    lines: [
      { speaker: "person", text: "I don't know where to start." },
      {
        speaker: "rep",
        text: "That's exactly what FLYR is built for. You pick a neighbourhood - we help you with that too if you need it - and the app builds your farm automatically. It pulls the address data, maps your route, and gives you a knock sequence. You're not figuring anything out. You just show up and follow the app.",
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
    say: "I just don't want to bother people.\nYou're not bothering them - you're introducing yourself as the person who knows their street better than anyone. No pitch. No close. Just a face, a name, and a reason to remember you. FLYR even gives you conversation starters based on local market data so you're always showing up with something valuable.",
    lines: [
      { speaker: "person", text: "I just don't want to bother people." },
      {
        speaker: "rep",
        text: "You're not bothering them - you're introducing yourself as the person who knows their street better than anyone. No pitch. No close. Just a face, a name, and a reason to remember you. FLYR even gives you conversation starters based on local market data so you're always showing up with something valuable.",
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
    say: "Nobody buys at the door. The door is just the introduction. The sale happens six months later when they remember your face and your name is the first one they call. FLYR tracks every single one of those introductions so you never lose the thread.",
    lines: [
      {
        speaker: "rep",
        text: "Nobody buys at the door. The door is just the introduction. The sale happens six months later when they remember your face and your name is the first one they call. FLYR tracks every single one of those introductions so you never lose the thread.",
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
    say: "That is great. FLYR is designed specifically for team leaders who want better visibility into what their agents are doing in the field.\nAre you currently tracking your door-to-door prospecting in any way?",
    lines: [
      {
        speaker: "rep",
        text: "That is great. FLYR is designed specifically for team leaders who want better visibility into what their agents are doing in the field.\n\nAre you currently tracking your door-to-door prospecting in any way?",
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
    say: "That's exactly the gap FLYR closes. Every door is logged in two taps, your follow-up sequence runs automatically, and you can see your whole farm on a live map. No spreadsheet, no notes, nothing lost.",
    lines: [
      {
        speaker: "rep",
        text: "That's exactly the gap FLYR closes. Every door is logged in two taps, your follow-up sequence runs automatically, and you can see your whole farm on a live map. No spreadsheet, no notes, nothing lost.",
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
    options: [{ label: "Position FLYR", nextId: "tracking-crm-close" }],
  },
  {
    id: "tracking-crm-close",
    label: "Tracking",
    kind: "close",
    title: "Close the software tracking gap",
    say: "That makes sense. FLYR can sit beside whatever you're using and handle the field layer: mapped territory, door outcomes, agent activity, and follow-up prompts before it becomes an actual lead.",
    lines: [
      {
        speaker: "rep",
        text: "That makes sense. FLYR can sit beside whatever you're using and handle the field layer: mapped territory, door outcomes, agent activity, and follow-up prompts before it becomes an actual lead.",
      },
    ],
    coach:
      "Position FLYR as the missing field-prospecting layer instead of a replacement for tools they already like.",
    options: QUICK_DEMO_CLOSE_OPTIONS,
  },
  {
    id: "pain-match",
    label: "Pain",
    kind: "question",
    title: "Connect the pain",
    say: "Totally fair. A lot of teams are in the same position.\nMost teams are putting in effort door knocking or handing out flyers, but they do not really have clear data on what is working, where their agents have been, or which leads need follow-up.\nThat is exactly why we built FLYR.\nIt gives team leaders real numbers on field activity, agent performance, territories covered, and leads generated.\nIf I could show you how your team could track all of that in one place, would that be worth taking a quick look at?\nYes.",
    lines: [
      {
        speaker: "rep",
        text: "Totally fair. A lot of teams are in the same position.\n\nMost teams are putting in effort door knocking or handing out flyers, but they do not really have clear data on what is working, where their agents have been, or which leads need follow-up.\n\nThat is exactly why we built FLYR.\n\nIt gives team leaders real numbers on field activity, agent performance, territories covered, and leads generated.\n\nIf I could show you how your team could track all of that in one place, would that be worth taking a quick look at?",
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
      "This splits 'not interested in farming' from 'not interested in FLYR specifically.' Do not close the call without learning which one it is.",
    options: [
      { label: "Farming is not for me", nextId: "fallback-not-convinced-farming" },
      { label: "Not sure about FLYR / timing", nextId: "fallback-not-convinced-flyr" },
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
    title: "Unsure about FLYR or timing",
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
    say: "I don't really track that, or not much.\nThat's actually common - most agents don't realize how much unattributed spend goes into staying visible. FLYR is a flat monthly cost that replaces a lot of that guesswork with something you can point to: doors knocked, contacts logged, listings sourced from the farm.",
    lines: [
      { speaker: "person", text: "I don't really track that, or not much." },
      {
        speaker: "rep",
        text: "That's actually common - most agents don't realize how much unattributed spend goes into staying visible.\n\nFLYR is a flat monthly cost that replaces a lot of that guesswork with something you can point to: doors knocked, contacts logged, listings sourced from the farm.",
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
    say: "I spend a fair amount already.\nThen this is probably going to feel cheap by comparison. FLYR starts at $30 USD per user per month, which is about $40 CAD.\nIf you're already spending on lead gen, the question is really whether this gives you cleaner tracking and better follow-up for less than what you're already paying.",
    lines: [
      { speaker: "person", text: "I spend a fair amount already." },
      {
        speaker: "rep",
        text: "Then this is probably going to feel cheap by comparison.\n\nFLYR starts at $30 USD per user per month, which is about $40 CAD.\n\nIf you're already spending on lead gen, the question is really whether this gives you cleaner tracking and better follow-up for less than what you're already paying.",
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
    title: "Send trial access",
    say: "Perfect. I will email that over now.\nI will also include access to a free trial so you can test it out with your team.\nIf you have any questions after watching it, feel free to reach out anytime.",
    lines: [
      {
        speaker: "rep",
        text: "Perfect. I will email that over now.\n\nI will also include access to a free trial so you can test it out with your team.\n\nIf you have any questions after watching it, feel free to reach out anytime.",
      },
    ],
    coach:
      "End cleanly, then email the video and trial link before moving to the next lead.",
    options: [{ label: "Done", nextId: "done" }],
  },
  {
    id: "done",
    label: "Done",
    kind: "done",
    title: "Call complete",
    say: "Log the outcome, email the 90-second video, include trial access, and set a follow-up.",
    lines: [
      {
        speaker: "rep",
        text: "Log the outcome, email the 90-second video, include trial access, and set a follow-up.",
      },
    ],
    coach: "The call outcome should be demo emailed with trial access.",
    options: [{ label: "Start again", nextId: "opening" }],
  },
];

export const REAL_ESTATE_QUICK_DEMO_SCRIPT_BODY = encodeScriptFlowBody(
  REAL_ESTATE_QUICK_DEMO_SCRIPT_FLOW,
);

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
