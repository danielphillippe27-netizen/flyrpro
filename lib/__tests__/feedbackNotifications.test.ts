import assert from 'node:assert/strict';
import { buildFeedbackNotificationEmail } from '@/lib/email/feedbackNotifications';

const email = buildFeedbackNotificationEmail({
  message: 'The map <button> needs work & clearer labels.',
  submitterEmail: 'owner@example.com',
  submitterUserId: 'user-123',
  workspaceId: 'workspace-456',
  role: 'owner',
  page: 'https://wolfgrid.app/home?tab=settings&mode=<test>',
  threadId: 'thread-789',
  requestOrigin: 'https://wolfgrid.app',
});

assert.equal(email.subject, 'New WolfGrid feedback from owner@example.com');
assert.equal(
  email.adminUrl,
  'https://wolfgrid.app/admin/feedback?thread=thread-789'
);
assert.match(email.text, /The map <button> needs work & clearer labels\./);
assert.match(email.text, /Workspace: workspace-456/);
assert.match(email.html, /The map &lt;button&gt; needs work &amp; clearer labels\./);
assert.match(email.html, /mode=&lt;test&gt;/);
assert.doesNotMatch(email.html, /The map <button>/);

console.log('feedback notification email tests passed');
