---
title: From Wix to Cloudflare, $408 a Year Down to Zero
date: 2026-08-01 14:00:00 +09:00
description: Two company websites, two days with Claude and Cursor. How I moved sites with no source files, kept the search traffic, and got the redesign I had postponed.
tags: [AI transformation, Claude, Cursor, website migration, Cloudflare, cost]
---

In [the first post](/en/posts/why-ai-transform/) I said I'd change how I work, using AI. So where do you start?

## The first thing a small company can actually cash in

AI can be applied almost anywhere. But if a small company wants a result it can **hold in its hands right now**, I think the place to look first is what IT infrastructure costs every month. Growing revenue has too many variables. Cutting a bill that was already going out shows a result immediately, and with certainty.

So I picked the first target: two company websites hosted on Wix.

## What we were paying

Both were static product pages, only a handful of screens each. The bill looked like this.

| Item | Cost |
|---|---|
| Premium Light plan (per site) | $17 / month |
| Two sites | $34 / month |
| Per year | $408 |

Four hundred dollars a year to keep two brochure sites online. Looking at that number again is where this started.

## Why we chose Wix in the first place

We are an IT company. And we still built our own homepage on Wix.

That wasn't laziness, it was the right call at the time. We couldn't spare a strong developer for the company website. Those people belonged on client projects. Wix was easy to build with and easy to maintain, and we bought that convenience for seventeen dollars a month.

The catch is that convenience gets billed **every month, forever**. What was reasonable at the start slowly turned into too much.

## The bigger cost wasn't the money

The real problem surfaced later, when we wanted to redesign the whole site.

Every screen had been assembled by dragging pieces into place, one page at a time. So applying a consistent design language across the site meant rebuilding those pages from scratch. Touch only part of it and the rest no longer matches. Touch all of it and the hours stop being affordable.

A small company is already busy with its actual business. We couldn't put time and people into this. So we missed the window for a redesign once, then missed it again. **The company site sat there, untouched.** While we paid thirty four dollars a month for it.

Money going out, site standing still. That combination is the real reason I finally moved.

## Why Cloudflare

There were plenty of cheap and free hosting options. I had two requirements.

First, **it had to load reliably outside Korea.** Our business involves customers abroad, so anything fast only at home was out.

Second, and this one mattered more, **no human hands in the deployment.** I needed this precisely so the neglect above wouldn't repeat. If changing something is a chore, you stop changing it, and once you stop, another few years go by. I had already lived through that once.

With Cloudflare, you connect a GitHub repository and **pushing the source is the deployment**. I edit with Cursor and Claude, push, and that's it. There is no separate release step. Making the site easy to change was worth more to me than the thirty four dollars. The setup is documented in [Cloudflare Pages' Git integration guide](https://developers.cloudflare.com/pages/get-started/git-integration/).

I looked at Vercel too, but my impression was that its strengths lean toward applications rather than brochure sites. What I was moving was a few static pages, and Cloudflare fit that shape better.

## The real wall wasn't the price, it was having no source

The plan was simple: move everything as is. And it stopped almost immediately.

We had built the sites in Wix **WYSIWYG style**, dragging things into place on screen. That meant there was no bundle of files sitting on my disk that I could hand to a new host. The furniture wasn't in boxes, it was painted onto the walls.

I had actually given up at this exact point years earlier. Back then I got tripped up by the small per host configuration details, one after another, until it ended as "let's do this later."

## Handing the whole site to Claude

This time I changed the approach. I used Claude Max, and gave it the site in two forms at once.

1. **Screenshots** of every page. What the finished thing is supposed to look like.
2. **A zip of the complete saved files**, pulled down with the browser's save page function. How the structure and the images actually sit.

Appearance and internals, together. Either one alone falls short. Screenshots only, and the pages look close but the insides are invented. Saved files only, and you drown in the machine generated markup Wix produces. Reading both, Claude rebuilt the sites in HTML, CSS and JS, nearly identical to the originals.

## What held me up longest was three letters: www

The thing that took the most time wasn't code. It was the **address**.

After I pointed the domain's nameservers at Cloudflare, typing the address with `www` and without it went to two different places. One showed the new site correctly. The other went right back to the old Wix site.

A nameserver change is not a switch you flip. It spreads across the internet over time, and during that window both sites are alive at once. Where you change it depends on who you bought the domain from, and [Cloudflare's guide to updating nameservers](https://developers.cloudflare.com/dns/nameservers/update-nameservers/) collects the instructions for the major registrars in one place. If you haven't decided where the `www` address and the bare address should each land, different visitors see different sites. Some get the new one, some get the old one.

This is exactly the category of problem that used to stop me. If you don't know the cause, "why does this one person still see the old page" eats a whole day. This time I described the symptom plainly, asked what to check, and worked through it. Which taught me something. It was never a task I **couldn't** do. It was a task I kept postponing because of how long finding out would take.

## Not breaking the search traffic

This is the part I was most careful about.

The sites had been running for years, so Google had pages indexed. If the addresses changed during the move, all the accumulated search traffic would vanish with them. Saving four hundred dollars while losing something worth more.

So I set a rule: **keep the URLs and the menu path structure exactly as they were.** Rebuild the screens if needed, but do not touch the addresses. Whenever a judgment call came up, I checked it before committing to it.

Google publishes guidance for exactly this case, [moving hosting without changing URLs](https://developers.google.com/search/docs/crawling-indexing/site-move-no-url-changes). Worth reading before you start. It spells out the obvious but easy to skip order of operations, like confirming the new host serves correctly before you take the old one down.

The last step was pointing the domain's nameservers at Cloudflare. Total elapsed time: **two days**.

## And then the redesign I'd been postponing

Once the move was done, one thing was still sitting there. The full redesign we hadn't managed for years.

This time the conditions were different. The site was now in my hands as HTML, CSS and JS files. So I asked Claude to propose a redesign for the whole site. We went back and forth over what it came up with, shaped the direction together, and switched to the result in one pass.

With WYSIWYG this had been unthinkable. Each page was built separately, so matching a design language meant reassembling all of them. **Once it was files, it became a matter of applying one set of rules across every page at once.** A different kind of job entirely.

So what came out of this isn't only the hosting savings. A company site that had been frozen and dated now looks like something built this year. Something postponed for years came along for the ride.

## What's left

| | Before | After |
|---|---|---|
| Hosting | Wix Premium Light x 2 | Cloudflare free plan |
| Monthly hosting | $34 | $0 |
| Yearly hosting | $408 | $0 |
| Deployment | by hand in the Wix editor | automatic on git push |
| Design | untouched for years | fully redesigned |
| URL structure | original | unchanged |

To be precise, the domain registration fee is unchanged. What went to zero is the hosting.

## If you're weighing the same thing

From the seat of someone running a small company:

- **Do the math yearly.** $34 a month sounds small. $408 a year makes a decision
- For a few static pages, a free plan is often genuinely enough
- No source files to hand over is not a dead end. Give **the screenshots and the saved files together**
- **Do not change the URL structure.** Search traffic costs more than hosting
- After a nameserver change, check the address **both with and without** `www`
- Watch the new site for a few days before you cancel the old plan
- Register the site in [Google Search Console](https://search.google.com/search-console). It is the only window you have into what happens to your search presence after the move, and it is free
- **Pick a host that deploys itself.** Anything that takes manual effort ends in neglect
- If your site is dated and you can't bring yourself to touch it, **redesign it while you move it.** Once the files are in your hands, relaying the whole design gets far lighter

## So

The move and the redesign had both been sitting on my list for years. Not because they were hard, but because I didn't know what would crawl out once I touched them. Watching both finish at once with Claude and Cursor genuinely surprised me.

And this isn't a story about one homepage. Every small company has other items shelved for years under "not urgent right now." What I confirmed this week is that there's a reason to pull that list back out.

The next link comes from that list.
