import assert from 'node:assert/strict';
import {
  buildCampaignAssignmentEmail,
  resolveCampaignAssignmentTeamLeaderName,
  type CampaignAssignmentEmailInput,
} from '@/lib/email/campaignAssignments';

const originalAssignmentFrom = process.env.CAMPAIGN_ASSIGNMENT_FROM_EMAIL;
const originalReplyTo = process.env.RESEND_REPLY_TO;

function input(
  overrides: Partial<CampaignAssignmentEmailInput> = {}
): CampaignAssignmentEmailInput {
  return {
    to: 'member@example.com',
    recipientName: 'Alex Member',
    teamLeaderName: 'Taylor Leader',
    teamLeaderEmail: 'taylor@example.com',
    campaignName: 'Just Listed',
    mode: 'zone_split',
    goalHomes: 41,
    zoneIndex: 3,
    dueAt: null,
    notes: null,
    campaignUrl: 'https://wolfgrid.app/?notifications=1',
    ...overrides,
  };
}

try {
  assert.equal(
    resolveCampaignAssignmentTeamLeaderName({
      firstName: 'Profile',
      lastName: 'Leader',
      metadataFullName: 'Metadata Leader',
    }),
    'Profile Leader'
  );
  assert.equal(
    resolveCampaignAssignmentTeamLeaderName({ metadataFullName: 'Metadata Leader' }),
    'Metadata Leader'
  );
  assert.equal(resolveCampaignAssignmentTeamLeaderName({}), 'WolfGrid Team');

  delete process.env.CAMPAIGN_ASSIGNMENT_FROM_EMAIL;
  delete process.env.RESEND_REPLY_TO;

  const zoneEmail = buildCampaignAssignmentEmail(input());
  assert.equal(zoneEmail.from, 'WolfGrid Notifications <notification@wolfgrid.app>');
  assert.equal(zoneEmail.replyTo, 'taylor@example.com');
  assert.equal(zoneEmail.subject, 'Zone 3 assigned: Just Listed');
  assert.match(zoneEmail.html, />Taylor Leader<\/p>/);
  assert.match(zoneEmail.html, />Team Leader<\/p>/);
  assert.match(zoneEmail.text, /Taylor Leader\nTeam Leader$/);
  assert.doesNotMatch(zoneEmail.html, /Daniel Phillippe|Founder/);
  assert.doesNotMatch(zoneEmail.text, /Daniel Phillippe|Founder/);

  const wholeTeamEmail = buildCampaignAssignmentEmail(
    input({ mode: 'whole_team', zoneIndex: null })
  );
  assert.equal(wholeTeamEmail.subject, 'Campaign assigned: Just Listed');
  assert.match(wholeTeamEmail.text, /Your team has been assigned this campaign together\./);

  process.env.RESEND_REPLY_TO = 'fallback@example.com';
  const missingLeaderEmail = buildCampaignAssignmentEmail(
    input({ teamLeaderName: null, teamLeaderEmail: null })
  );
  assert.equal(missingLeaderEmail.replyTo, 'fallback@example.com');
  assert.match(missingLeaderEmail.html, />WolfGrid Team<\/p>/);
  assert.match(missingLeaderEmail.text, /WolfGrid Team\nTeam Leader$/);

  delete process.env.RESEND_REPLY_TO;
  const notificationReplyFallback = buildCampaignAssignmentEmail(
    input({ teamLeaderEmail: null })
  );
  assert.equal(notificationReplyFallback.replyTo, 'notification@wolfgrid.app');

  process.env.CAMPAIGN_ASSIGNMENT_FROM_EMAIL =
    'Custom Assignments <assignments@wolfgrid.app>';
  const customSender = buildCampaignAssignmentEmail(input());
  assert.equal(customSender.from, 'Custom Assignments <assignments@wolfgrid.app>');

  const escapedLeader = buildCampaignAssignmentEmail(
    input({ teamLeaderName: 'Taylor <Leader>' })
  );
  assert.match(escapedLeader.html, />Taylor &lt;Leader&gt;<\/p>/);

  console.log('campaign assignment email tests passed');
} finally {
  if (originalAssignmentFrom === undefined) {
    delete process.env.CAMPAIGN_ASSIGNMENT_FROM_EMAIL;
  } else {
    process.env.CAMPAIGN_ASSIGNMENT_FROM_EMAIL = originalAssignmentFrom;
  }
  if (originalReplyTo === undefined) {
    delete process.env.RESEND_REPLY_TO;
  } else {
    process.env.RESEND_REPLY_TO = originalReplyTo;
  }
}
