# WOLFGRID — PRO SALES & REVENUE TRACKING SYSTEM

## PRODUCT GOAL

Transform WolfGrid from primarily a canvassing/territory application into a complete field-sales performance platform.

WolfGrid should answer five questions instantly:

1. What activity is happening in the field?
2. What leads and appointments are being generated?
3. What actually turned into sales?
4. Which reps, campaigns, territories, and activities generated those sales?
5. How much revenue did those activities produce?

The fundamental WolfGrid funnel is:

DOOR → CONVERSATION → LEAD → APPOINTMENT → OPPORTUNITY → SALE → REVENUE

Every sale should be attributable backward through this funnel whenever possible.

The product should remain extremely simple for field reps while giving managers deep analytics.

Design philosophy:

* Apple/Airbnb-level simplicity
* Data-first
* Minimal visual clutter
* Fast enough to use while standing at a door
* Advanced analytics available through drill-downs rather than overwhelming the main UI
* Mobile optimized for reps
* Web/dashboard optimized for managers
* No unnecessary gamification
* Wolfy AI is secondary to the sales data

---

# 1. CORE SALES OBJECT

Create a first-class `Sale` entity.

A sale must NOT simply be a number attached to a lead.

Each Sale should support:

* sale ID
* workspace ID
* customer/prospect ID
* property/address ID
* campaign ID
* territory ID
* original canvassing event ID
* lead ID
* appointment ID
* opportunity ID
* primary rep ID
* setter ID
* closer ID
* team ID
* date created
* date sold
* contract value
* expected revenue
* collected revenue
* sale status
* product/service
* notes
* attribution source
* attribution confidence
* cancellation status
* cancellation reason
* completion/install status
* timestamps
* audit history

Allow multiple reps to receive attribution where appropriate.

Example:

123 Main Street

Knocked:
Jake — Sept 1

Conversation:
Sept 1

Lead:
Sept 1

Appointment:
Sept 3

Closer:
Chris

Sold:
Sept 5

Contract:
$18,750

WolfGrid should preserve this entire chain.

---

# 2. SALES PIPELINE

Create a lightweight sales pipeline.

Default stages:

NEW LEAD

↓

CONTACTED

↓

APPOINTMENT SET

↓

APPOINTMENT COMPLETED

↓

OPPORTUNITY

↓

PROPOSAL / ESTIMATE

↓

SOLD

↓

INSTALL / FULFILLMENT

↓

COMPLETED

↓

COLLECTED

Also support:

LOST

CANCELLED

NO SHOW

FOLLOW-UP

Allow workspace admins to customize pipeline stages.

However, WolfGrid should ship with excellent defaults so teams do not need to configure anything before using it.

---

# 3. MARK AS SOLD

This is one of the most important actions in the application.

From a prospect, lead, appointment, opportunity, property or pipeline record:

MARK AS SOLD

Open a beautiful bottom sheet/modal.

Required:

Sale amount / contract value

Optional:

Product/service
Sold date
Closer
Setter
Notes
Expected install/completion date

Primary CTA:

CONFIRM SALE

This interaction should take approximately 5–10 seconds.

After confirming:

* prospect status becomes Sold
* opportunity becomes Won
* sale object is created
* rep metrics update
* team metrics update
* campaign metrics update
* territory metrics update
* leaderboard updates
* revenue analytics update

Use subtle success animation/haptic feedback.

Do NOT make the experience childish.

---

# 4. REVENUE DEFINITIONS

WolfGrid must distinguish between:

## SOLD VALUE

Total signed contract value.

Example:

Customer signs $18,000 roofing contract.

Sold Value = $18,000.

## COMPLETED VALUE

Value of work that has actually been completed/installed.

## COLLECTED REVENUE

Money actually received by the company.

These numbers must NEVER be incorrectly treated as identical.

Managers should be able to see:

$842,500 SOLD

$617,200 COMPLETED

$541,800 COLLECTED

For V1, Sold Value is the primary metric.

Architecture must support Completed and Collected from the beginning.

---

# 5. ATTRIBUTION ENGINE

Build a serious attribution system.

WolfGrid's competitive advantage should be connecting field activity directly to revenue.

Every sale should attempt to answer:

WHO generated it?

WHERE did it originate?

WHICH campaign generated it?

WHICH territory generated it?

WHICH activity generated it?

WHEN was the original prospecting interaction?

### Attribution dimensions

Rep

Setter

Closer

Team

Campaign

Territory

Property/address

Lead source

Original knock

QR campaign

Manual lead

Referral

Inbound

Other

### Example

$24,500 Sale

Source:
Door Knock

Setter:
Jake

Closer:
Chris

Campaign:
Ajax Storm Response

Territory:
Zone 14

Original Knock:
August 17

Sold:
August 24

WolfGrid now understands that the $24,500 came from the Ajax Storm Response campaign and can attribute the activity correctly.

---

# 6. SETTER/CLOSER MODEL

Field sales organizations often separate lead generation from closing.

Support:

SETTER

CLOSER

and

FULL-CYCLE REP

Example:

Jake knocks the door.

Jake creates lead.

Jake books appointment.

Chris runs appointment.

Chris closes $22,000 deal.

WolfGrid records:

Setter: Jake

Closer: Chris

Sale: $22,000

Both should receive appropriate performance credit without double-counting company revenue.

Company revenue = $22,000.

NOT $44,000.

Leaderboards can separately show:

Top Setters

Top Closers

Top Revenue

Top Sales

---

# 7. ATTRIBUTION RULES

Create deterministic attribution logic.

Priority:

1. Existing prospect/property record
2. Existing lead
3. Existing appointment
4. Original canvassing activity
5. Campaign
6. Territory
7. Manual source

Do not silently guess attribution when evidence is weak.

Store:

Attribution source

Attribution method

Attribution confidence

Allow managers to manually correct attribution.

Keep an audit log of changes.

Example:

Original attribution:
Jake

Changed to:
Jake + Chris

Changed by:
Manager

Date:
Sept 15

---

# 8. REP HOME SCREEN

The rep Home screen should immediately answer:

HOW AM I DOING?

Primary section:

THIS WEEK

Weekly goal progress

Example:

$42,500 / $60,000 SOLD

71%

Secondary metrics:

Doors
342

Conversations
108

Leads
24

Appointments
11

Sales
4

Revenue
$42.5K

Close Rate
36%

The exact metrics displayed should depend on the workspace configuration.

Large CTA at bottom:

START / OPEN CAMPAIGN

Wolfy Coach can exist beneath the performance data as a small AI input:

“Ask Wolfy about your performance”

Wolfy is NOT the hero of the screen.

Performance is the hero.

---

# 9. MANAGER DASHBOARD

Build a professional manager dashboard.

Top KPI row:

TOTAL SOLD

SALES

AVG TICKET

CLOSE RATE

PIPELINE VALUE

Example:

$842K Sold

57 Sales

$14.8K Avg Ticket

31% Close Rate

$1.2M Pipeline

Allow date filters:

Today

Yesterday

This Week

Last Week

This Month

Last Month

Quarter

Year

Custom

Allow comparison:

vs previous period

Example:

$842K
↑ 18.4%

---

# 10. FULL FUNNEL DASHBOARD

Managers need to see the entire funnel.

Example:

4,812
DOORS

↓

1,247
CONVERSATIONS
25.9%

↓

284
LEADS
22.8%

↓

143
APPOINTMENTS
50.4%

↓

101
APPOINTMENTS COMPLETED
70.6%

↓

41
SALES
40.6%

↓

$612,450
SOLD

Every step should calculate conversion rates.

Allow clicking any stage to inspect the underlying records.

---

# 11. REP PERFORMANCE DASHBOARD

Each rep receives a performance profile.

Example:

JAKE MARTIN

THIS MONTH

Doors
1,240

Conversations
381

Leads
82

Appointments
39

Sales
14

Sold
$218,400

Average Ticket
$15,600

Conversation Rate
30.7%

Lead Rate
21.5%

Appointment Rate
47.6%

Close Rate
35.9%

Revenue / Door
$176

Revenue / Conversation
$573

Revenue / Lead
$2,663

Show trends against:

Previous period

Team average

Personal average

Personal best

Do not create meaningless metrics simply because they can be calculated.

---

# 12. LEADERBOARDS

Create a dedicated leaderboard system.

Tabs:

SALES

REVENUE

APPOINTMENTS

LEADS

DOORS

CONVERSATIONS

CLOSE RATE

Optional:

SETTERS

CLOSERS

Filters:

Today

Week

Month

Quarter

Custom

Campaign

Team

Territory

Only show close-rate rankings once a configurable minimum opportunity threshold is reached.

This prevents someone with 1/1 deals from appearing above someone with 30/50.

---

# 13. SALES LEADERBOARD

Default sales leaderboard:

1. Jake
   $218,400
   14 sales

2. Chris
   $194,700
   12 sales

3. Sarah
   $171,200
   13 sales

Show:

Rank

Rep

Revenue

Sales

Average Ticket

Trend

Allow managers to choose whether ranking is based on:

Sales count

Sold value

Collected revenue

---

# 14. CAMPAIGN ROI

This should be one of WolfGrid's strongest features.

Every campaign should show:

Doors

Conversations

Leads

Appointments

Sales

Sold Value

Avg Ticket

Close Rate

Revenue / Door

Revenue / Lead

Example:

AJAX STORM RESPONSE

1,842 doors

493 conversations

126 leads

61 appointments

22 sales

$384,500 sold

$17,477 avg ticket

$209 revenue/door

Now the owner can compare campaigns.

---

# 15. TERRITORY REVENUE

Connect revenue directly to WolfGrid's mapping engine.

Every territory should understand:

Doors worked

Coverage %

Leads

Appointments

Sales

Sold Value

Revenue / Door

Conversion Rate

Display territory performance on the map.

Potential visualization modes:

Activity

Lead Density

Appointment Density

Sales Density

Revenue

Conversion

This creates a powerful question:

“Which neighborhoods actually make us money?”

---

# 16. PROPERTY SALES HISTORY

Properties should retain history.

Example:

123 MAIN STREET

Knocked
Sept 1 — Jake

Lead
Sept 1

Appointment
Sept 3

Estimate
Sept 3

Sold
Sept 5

$18,750

Completed
Sept 18

Collected
Sept 20

This creates a permanent field-sales record for the property.

---

# 17. SALES MAP

Create a map layer specifically for sales.

Properties that became sales should be visually distinguishable.

Map filters:

Sold Today

Sold This Week

Sold This Month

Sale Value

Rep

Campaign

Product

Team

Clicking a sold property opens:

Customer

Sale amount

Rep

Campaign

Timeline

Original activity

---

# 18. SALES FEED

Create a real-time team activity feed.

Examples:

JAKE CLOSED A SALE
$18,750
Ajax Storm Response
2 minutes ago

SARAH SET AN APPOINTMENT
Pickering East
8 minutes ago

CHRIS CLOSED A SALE
$26,400
Whitby North
14 minutes ago

Keep it professional.

Managers should be able to configure which events appear.

---

# 19. GOALS

Support goals at:

Individual rep

Team

Workspace

Campaign

Goal types:

Doors

Conversations

Leads

Appointments

Sales

Sold Value

Collected Revenue

Example:

SEPTEMBER TEAM GOAL

$750,000 / $1,000,000

75%

Individual:

WEEKLY SALES GOAL

$42,500 / $60,000

71%

---

# 20. FORECASTING

Once enough data exists, introduce lightweight forecasting.

Example:

SEPTEMBER TARGET
$1,000,000

Current
$612,000

Projected
$947,000

PACE
94.7%

Required Daily Sales
$48,500/day

Do not pretend forecasting is certain.

Clearly distinguish:

Actual

Pipeline

Projected

Goal

---

# 21. PIPELINE VALUE

Manager dashboard should show open pipeline.

Example:

OPEN PIPELINE

72 opportunities

$1.34M potential value

Breakdown:

Appointment
$280K

Estimate
$410K

Proposal
$370K

Follow-up
$280K

Managers can drill into stalled opportunities.

---

# 22. LOSS TRACKING

Sales systems are incomplete if they only track wins.

When an opportunity becomes LOST, allow:

Price

Competitor

No Decision

Unable to Contact

Financing

Timing

Not Qualified

Cancelled

Other

Optional note.

Manager dashboard:

TOP LOSS REASONS

Price — 32%

No Decision — 21%

Competitor — 18%

Unable to Contact — 14%

Other — 15%

---

# 23. CANCELLATIONS

Sales can cancel after signing.

Support:

SOLD

→ CANCELLED

Never delete the original sale.

Instead record:

Original sold value

Cancellation date

Cancellation reason

Rep

Campaign

Net sold value

This prevents sales numbers from becoming artificially inflated.

Show:

Gross Sold

Cancellations

Net Sold

---

# 24. DUPLICATE PROTECTION

Prevent duplicate revenue.

If a rep attempts to create another sale for the same active opportunity/property/customer:

Warn:

“An existing sale may already be associated with this customer.”

Allow manager override.

Do not automatically block legitimate multiple jobs at the same property.

---

# 25. PERMISSIONS

REP

Can see:
Own performance
Own leads
Own sales
Allowed team leaderboard data

MANAGER

Can see:
Team
Campaign
Territory
Sales
Revenue
Pipeline

ADMIN / OWNER

Can see:
Entire workspace
Revenue
Financial analytics
Attribution
Settings
Audit history

Allow admins to hide dollar revenue from reps if desired.

---

# 26. SALES NOTIFICATIONS

Useful notifications:

Appointment booked

Appointment starting soon

Lead requires follow-up

Sale closed

Sale cancelled

Rep reached goal

Team reached goal

Opportunity stale

Avoid notification spam.

Workspace admins should control notifications.

---

# 27. CRM-LITE CONTACT RECORD

WolfGrid does not need to become Salesforce.

But every prospect should have:

Name

Phone

Email

Address

Status

Assigned rep

Lead source

Campaign

Notes

Activity timeline

Appointments

Opportunity

Sales history

Follow-up date

Tags

The goal is enough CRM functionality to manage field-generated business without turning WolfGrid into an enormous generic CRM.

---

# 28. FOLLOW-UP SYSTEM

Field sales is not always one-touch.

Support:

Follow up tomorrow

Specific date/time

Custom reminder

Follow-up queue

Manager view of overdue follow-ups.

Rep Home could show:

TODAY

4 Follow-ups

2 Appointments

Weekly Goal 71%

---

# 29. SEARCH

Global search should locate:

Customer

Phone

Email

Address

Rep

Campaign

Sale

Opportunity

Territory

Fast enough for managers to use WolfGrid as an operational system.

---

# 30. EXPORTS

Managers should be able to export:

Sales

Leads

Appointments

Rep performance

Campaign analytics

Territory analytics

CSV export.

Structure the backend so accounting/CRM integrations can eventually sync this information.

---

# 31. API / INTEGRATION ARCHITECTURE

Build sales entities with external integrations in mind.

Potential future integrations:

CRM

Accounting

Payments

Financing

Call tracking

Marketing platforms

Webhook/API events should eventually support:

lead.created

appointment.created

opportunity.created

sale.created

sale.updated

sale.cancelled

job.completed

payment.collected

Do not tightly couple core sales logic to any one third-party provider.

---

# 32. INDUSTRY-AWARE METRICS

Do NOT hard-code WolfGrid around roofing forever.

Create configurable outcome terminology.

HOME SERVICES

Sales
Contract Value
Average Ticket
Revenue

SOLAR

Sales
Contract Value
System Size
Revenue

REAL ESTATE

Transactions
Sales Volume
GCI
Listings
Buyer Transactions

Other industries should be able to configure terminology later.

The underlying data architecture should remain consistent.

---

# 33. REAL ESTATE MODE

Do not force real estate users into roofing terminology.

Potential real estate pipeline:

Lead

Appointment

Consultation

Signed Client

Active Buyer / Listing

Under Contract

Closed

Metrics:

Appointments

Clients Signed

Listings Taken

Buyer Agreements

Transactions

Sales Volume

GCI

Example:

12 Transactions

$8.4M Volume

$176K GCI

---

# 34. WOLFY AI — REPOSITION

Wolfy should become an intelligence layer over the sales system.

NOT a Tamagotchi.

NOT primarily accessories.

NOT primarily XP.

Wolfy should analyze actual performance.

Example:

“You're ahead of your door goal by 14%, but your lead conversion is 18% below your 30-day average.”

Example:

“You generate the most revenue between 4 PM and 7 PM.”

Example:

“Ajax Storm Response is producing 2.3× more revenue per door than your other active campaigns.”

Example:

“Chris has 8 opportunities that haven't been followed up with in 72 hours.”

Wolfy should answer questions such as:

“How am I doing this week?”

“Who is my best closer?”

“Which campaign generated the most revenue?”

“Where should the team knock tomorrow?”

“Who needs coaching?”

“What part of our funnel is weakest?”

This makes AI useful because it understands WolfGrid's proprietary field activity + sales data.

---

# 35. DATA INTEGRITY

Financial metrics must be trustworthy.

Never:

Double count sales

Count cancelled sales as active sold revenue

Confuse contract value with collected revenue

Credit multiple reps while multiplying company revenue

Lose attribution when a rep changes teams

Rewrite historical performance incorrectly

All major changes should have auditability.

---

# 36. HISTORICAL SNAPSHOTS

Team membership and campaign changes must not corrupt historical reporting.

If Jake was on Team Alpha when a sale occurred and later joins Team Beta, historical reports for the original period should still correctly represent Team Alpha.

Store appropriate historical associations.

---

# 37. TIMEZONE HANDLING

All events should store timestamps correctly and display using workspace/user timezone.

Date filtering must be consistent across:

Rep dashboard

Manager dashboard

Campaign reports

Leaderboards

Exports

---

# 38. PERFORMANCE

Dashboards must feel instant.

Avoid recalculating
