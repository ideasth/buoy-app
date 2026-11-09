# Buoy uptime check with Power Automate (Stage 32)

Buoy publishes a small public feed at `https://buoy.thinhalo.com/api/status.rss`.
It has one item. Its title is `OK`, or `PROBLEM: <labels>` (database,
scheduler stopped, calendar planning stale, mail check stale, mail check failing).
It contains no names, subjects or error text.

Microsoft checks it from outside, so a full VPS or Caddy outage is caught too.
Only Standard connectors are used (RSS, Notifications, Outlook), so no Premium licence is needed.

## Build the flow (about 10 minutes)

1. Go to make.powerautomate.com, signed in with the AUPFHS account.
2. Create > Scheduled cloud flow. Name: `Buoy uptime`. Repeat every 15 minutes. Create.
3. New step > RSS > **List all RSS feed items**.
   - RSS feed URL: `https://buoy.thinhalo.com/api/status.rss`
   - Settings (the three dots): Retry policy = Fixed interval, Count 2, Interval `PT1M`.
4. New step > **Condition**.
   - Left: expression `first(body('List_all_RSS_feed_items'))?['title']`
   - Operator: is not equal to. Right: `OK`
5. In **If yes**: add Notifications > **Send me a mobile notification**.
   - Text: `Buoy: ` then the same expression as step 4.
   - Link: `https://buoy.thinhalo.com/#/on-time`
6. Hover on the arrow between "List all RSS feed items" and the Condition, click **+** >
   **Add a parallel branch** > Notifications > **Send me a mobile notification**.
   - Text: `Buoy is not responding (feed unreachable)`. Link as above.
   - Its three dots > **Configure run after** > untick "is successful", tick
     **has failed** and **has timed out**. Done.
7. Save. Install the Power Automate phone app and sign in, so the notifications arrive.
   (An Outlook "Send an email (V2)" to yourself works instead, if you prefer email.)

## Test it

- Run > Test > Manually. The run should succeed with no notification.
- To prove the alert path, temporarily change the URL to
  `https://buoy.thinhalo.com/api/status-missing.rss`, test, then change it back.

## Notes

- You will be alerted every 15 minutes while a problem lasts. That is deliberate: it stops once fixed.
- Just after a deploy Buoy allows a 2-minute grace period, so a restart won't trigger a false alarm.
- The paused Perplexity uptime automation (400be0a4) stays paused; this replaces it.
