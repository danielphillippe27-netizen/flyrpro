// Edit this file to change the preview's copy, links, and product imagery.
export const content = {
  brand: 'WolfGrid',
  hero: {
    title: 'The field sales system for reps and teams',
    description: 'Purpose-built for working territories and winning business. Every door. Every conversation. Connected.',
    announcement: 'Explore a new dimension of field sales',
    image: '/landing/hero-dashboard-map.png',
    imageAlt: 'WolfGrid campaign dashboard with addresses displayed on a three-dimensional territory map',
  },
  primary: { label: 'Get started', href: '/signup' },
  demo: { label: 'Explore the demo', href: '/demo1?start=fresh' },
  industries: ['Roofing', 'Solar', 'Pest control', 'Real estate', 'Home services'],
  intro: {
    title: 'A new perspective on field sales.',
    description: 'Built around the way you work in the field, WolfGrid brings territories, conversations, and your team into one connected system.',
  },
  principles: [
    { title: 'Purpose-built', description: 'Designed for the people who turn a knock on the door into an opportunity.' },
    { title: 'Connected by design', description: 'Your map, your leads, and your team. Working together in one place.' },
    { title: 'Made for momentum', description: 'Less time managing software. More time having conversations.' },
  ],
  sections: [
    { id: 'territories', label: '01 / TERRITORIES', title: 'See the opportunity.\nOwn your territory.', description: 'Bring your next campaign into focus. Explore homes in 3D, define your territory, and give every rep a clear place to start.', features: [ ['3D prospecting', 'Explore addresses and buildings together in a visual map built for field work.'], ['Campaign planning', 'Create focused campaigns around the neighborhoods you want to reach.'], ['Territory assignments', 'Give your team clear ownership of the areas they are working.'] ] },
    { id: 'conversations', label: '02 / CONVERSATIONS', title: 'Every door opens\na possibility.', description: 'Turn activity into a next step. Capture leads, keep the details, and know exactly where to pick up the conversation.', features: [ ['Quick statuses', 'Log no answer, a conversation, or a lead while the interaction is still fresh.'], ['Lead management', 'Keep contact details and notes connected to the address you visited.'], ['Follow-ups', 'Plan the next conversation and keep appointments in view.'] ] },
    { id: 'teams', label: '03 / TEAMWORK', title: 'One team.\nA shared direction.', description: 'Connect what happens in the field with what happens next. See activity, coordinate territories, and keep your team moving together.', features: [ ['Team visibility', 'Keep a shared view of field activity and territory progress.'], ['Leaderboards', 'Bring friendly competition to your team’s daily activity.'], ['Performance insights', 'Understand doors visited, conversations started, and leads captured.'] ] },
    { id: 'connected', label: '04 / CONNECTED WORK', title: 'From the first knock\nto the next step.', description: 'Keep your field workflow connected. Bring your existing tools along, and take WolfGrid with you from the desktop to the doorstep.', features: [ ['Integrations', 'Connect your field workflow with supported CRM integrations and Zapier.'], ['Mobile and desktop', 'Plan on a bigger screen. Take your territories into the field.'], ['QR campaigns', 'Connect printed outreach to digital touchpoints.'] ] },
  ],
  closing: { title: 'Your next opportunity\nis out there.', description: 'Put it on the grid.' },
} as const;
