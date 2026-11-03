# 001: Block Reflectionbot instead of caching the events page

**Decision:** Tell one AI crawler, Reflectionbot, to stay off the whole site through `robots.txt` (the file a site uses to tell crawlers which pages they may visit). We did not add caching to `/events` at this stage.

## Why this came up

Starting Oct 26, 2026, the Field Guide's database stopped going to sleep. Neon only charges for its database while it is awake, and it naps after 5 minutes with no queries. It was awake about 24 hours a day, on pace for about $77 a month on its own.

Vercel's request logs (Nov 3, 17:18–18:18 UTC) showed why. 372 of 375 requests came from Reflectionbot, Reflection AI's crawler. It fetched the same page, `/events`, about every 12 seconds. That page is rebuilt from the database on every visit. Real visitors made 3 requests in that hour.

If we got this wrong, we would either keep paying for a database that never sleeps, or we would block traffic we actually want.

## Options

1. **Block Reflectionbot in `robots.txt`.** One rule. Reflection AI says the bot obeys it and notices changes within about a day. Cost: up to a day of continued traffic, and the site stays out of whatever Reflection AI builds from crawled pages.
2. **Cache `/events`** so repeat visits skip the database for a few minutes. This protects against any future bot. Cost: more code, because the cache stores data as JSON and the event dates would come back as text that has to be converted again. It also needs care so "upcoming events" doesn't go stale.
3. **Block the bot in Vercel's firewall.** Takes effect immediately. Cost: Reflection AI explicitly asks site owners to use `robots.txt` instead, and a firewall rule is a production setting that is easy to forget about.

## What we chose and why

Option 1. Decided jointly by Tarik and Claude: Claude found the cause and recommended it, and Tarik approved a pull request. One bot caused 99% of the load and has promised to honor this file. The rule only names that bot, so Google and real visitors are not affected. Caching would add code to protect against a bot we haven't seen yet.

## What we gave up

- Up to a day of continued database wake-ups while the crawler picks up the change.
- No protection against the next crawler that ignores `robots.txt` or hammers a dynamic page.
- The site is no longer available to Reflection AI's crawler at all.

## How we'll know if this was right

- Within 2 days of deploying, Neon's daily compute for the `mke-events` project falls from about 24 hours of awake time to near the pre-Oct 26 level (0.4–8 a day).
- Vercel's request logs show no `Reflectionbot` requests after it re-reads `robots.txt`.
- If a different bot shows up the same way, revisit option 2.

## What actually happened

