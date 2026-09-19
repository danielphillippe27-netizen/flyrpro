import assert from 'node:assert/strict';
import { cardContentSchema,canReceiveCard,cardTextColor,isPreview,vcard,cardMessage } from '../contracts';
const card=cardContentSchema.parse({name:'Daniel',phone:'+12896752788',socials:[{platform:'Instagram',url:'https://instagram.com/example'}]});
assert(isPreview('facebookexternalhit/1.1'));
assert(isPreview('Slackbot-LinkExpanding'));
assert(!isPreview('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1'));
for(const url of ['javascript:alert(1)','http://example.com','https://user:password@example.com'])assert(!cardContentSchema.safeParse({...card,socials:[{platform:'Instagram',url}]}).success);
assert(!cardContentSchema.safeParse({...card,socials:[...card.socials,...card.socials]}).success);
assert.equal(vcard({...card,name:'A\nB;C,D'}).includes('FN:A\\nB\\;C\\,D'),true);
assert(cardMessage('Sarah Smith',card.phone,'https://wolfgrid.app/c/token').startsWith('Hey Sarah,'));
assert(!cardMessage('Sarah','', 'url').includes('got it'));
assert(!cardMessage('Sarah','', 'url').includes('directly at'));
console.log('Business card content, URL, preview, message, and vCard contracts passed');

assert.equal(card.companyLogo,undefined);
assert.equal(cardContentSchema.parse({...card,companyLogo:'https://example.com/logo.svg'}).companyLogo,'https://example.com/logo.svg');
assert(!cardContentSchema.safeParse({...card,companyLogo:'javascript:alert(1)'}).success);

assert.equal(cardTextColor("#FFFFFF"),"#151719");
assert.equal(cardTextColor("#000000"),"#ffffff");
assert(!cardContentSchema.safeParse({...card,theme:{header:"red",accent:"#123456",background:"#FFFFFF"}}).success);

assert(canReceiveCard('', 'person@example.com'), 'Email-only contacts can receive cards');
assert(canReceiveCard('(289) 555-1234', ''), 'Formatted phone numbers can receive cards');
assert(canReceiveCard(null, ' person@example.com '));
for (const [phone, email] of [['', ''], ['123', 'invalid'], ['abcdefg1234567', ''], ['1234567890123456', ''], ['', 'a@']]) {
 assert(!canReceiveCard(phone, email), `Reject invalid recipient: ${phone} / ${email}`);
}
console.log('Business card phone/email recipient contracts passed');
