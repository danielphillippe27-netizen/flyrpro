# Country and Type storm browser — October 24, 2026

Production: dpl_7fwFVhpVb2M4n8Jw48q2ZzBRsufj, staged from /tmp/wolfgrid-simple-storms-release over the previously verified iOS wind release, with eleven scoped runtime files. Shared by web and the iOS/Android mobile workbench; reopen an existing native Storm Maps sheet to receive it.

The Find storm screen now has exactly two selectors: Country (Canada, United States, Australia, New Zealand) and Type (Hail, Wind). The Storm reports/Australia/Wind history tabs, location input, gust threshold, date and hour selectors, hail severity selector, and report-filter panel are absent from this simplified browser. Existing standalone components retain their full mode for compatibility; the new browser uses their compact mode.

Wind defaults to the established 93.341952 km/h (58 mph) threshold. The list groups indexed saved hours by UTC day, showing the largest regional estimate and number of saved qualifying hours. Daily summaries are not counts of distinct storms. Tapping a day opens its strongest saved hour and the existing gust-area/territory/campaign flow. Back returns to the list. Older history loads in thirty-day pages. Existing campaign evidence links preserve their exact archived hour and supported wind threshold rather than replacing them with a daily peak. Changing country clears the old evidence-link context.

Country selectors choose the existing retained regional coverage rectangles, which include nearby waters and land; the wind data is not clipped to administrative country borders. This is stated in the UI. No storm names, locations of the regional maximum, confirmed damage, or distinct system counts are inferred from hourly maxima.

Hail routes are country-specific: US report discovery uses the existing IEM source; Australia uses saved Xweather modeled hail detections. Canada and New Zealand show daily hail maps with a clear coverage/report-catalog limitation; U.S. reports are never shown under those countries. These daily map choices are explicitly not claims of detected storms. Existing hail area selection is preserved.

Verification:
- New storm-browser integration test passes: exactly two selectors, all four country routes, isolation of U.S. hail reports, duplicate wind snapshot handling, peak hour selection, country changes, and exact campaign evidence links.
- Existing six Storm Maps suites and the new browser suite all pass via npm run test:storm-maps.
- Both mobile session/wind suites pass via npm run test:mobile-storms.
- Focused ESLint passes. Changed implementation and tests have no TypeScript diagnostics; unrelated existing repository diagnostics remain.
- Production build succeeded. Signed-in desktop Chrome shows exactly two select elements and populated US wind dates. Selecting October 23 opens the 23:00 UTC saved wind map with visible shading. No production test campaigns or territories were created for this UI change.
- Native physical UI interaction remained limited by the existing Mirroring input issue. This change uses the same shared workbench; no native binary/signing changes or App Store update are required.

Recent activity checked directly from the private wind archive: the October 24 UTC regional estimates reached approximately CA 122, US 142, AU 99, NZ 105 km/h. These are regional gridded estimates, not confirmed damage or country-only ground reports. Snapshot: recent-wind-2026-10-24.json.

Independent public NWS local storm reports retrieved through Iowa State IEM included 89 mph (143 km/h) 10 miles east of Whitlash, Montana at October 23 19:15 UTC, and 66 mph (106 km/h) 3 miles northwest of Wasta, South Dakota at October 24 09:58 UTC. These are reported gusts; they do not establish damage. The report times correspond to October 23 and 24 respectively in Toronto and in the local reporting regions. Snapshot and source URL: recent-reported-wind-2026-10-24.json.

Live follow-up: DOM inspection confirmed exactly two selectors (Storm country, Storm type). The user also switched to Australia and opened its October 19 00:00 UTC saved wind map while the agent observed. Final UI screenshot: two-storm-filters-2026-10-24.png. No further navigation was performed after observing the user’s selection.
