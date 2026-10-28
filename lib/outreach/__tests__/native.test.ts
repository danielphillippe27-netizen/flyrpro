import assert from 'node:assert/strict';
import { phoneDestination, emailDestination, nativeContactUrl, recipientsFor } from '../native';
assert.equal(phoneDestination('+1 (416) 555-1234 ext 99'), '+14165551234');
assert.equal(phoneDestination('4165551234,99'), '4165551234');
assert.equal(phoneDestination('123'), null);
assert.equal(emailDestination('a@example.com?bcc=b@example.com'), null);
assert.equal(emailDestination(' a@example.com '), 'a@example.com');
const contacts = [
  { id: 'a', full_name: 'A', phone: '+1 (416) 555-1234', email: 'a@example.com' },
  { id: 'b', full_name: 'B', phone: '4165551234', email: 'A@example.com' },
  { id: 'c', full_name: 'C', phone: null, email: null },
];
assert.deepEqual(recipientsFor(contacts, 'call').map(c => c.id), ['a']);
assert.deepEqual(recipientsFor(contacts, 'email').map(c => c.id), ['a']);
assert.equal(nativeContactUrl(contacts[0], 'message'), 'sms:+14165551234');
assert.equal(nativeContactUrl(contacts[0], 'call'), 'tel:+14165551234');
console.log('Native outreach validation passed.');
