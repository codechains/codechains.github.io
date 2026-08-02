---
title: Google Apps Script Already Worked. Here's Why I Added n8n
date: 2026-08-03
description: My quote automation already worked in Google Apps Script. I brought in n8n anyway. Why I added a second tool, and which jobs Google Apps Script still owns.
tags: [AI automation, AI transformation, n8n, Google Apps Script, workflow automation]
---

In the last post I wrote that I'd finished [quote automation](/en/posts/google-apps-script-quote-automation/) in Google Apps Script. Then I went and added n8n on top. This post is about why.

## A successful quote automation, built with Claude Code

The quote automation still runs on Google Apps Script today. A request comes in, prices and discount rates get calculated, the exchange rate is applied, and a PDF goes out by email. No human hands in the middle.

And in this territory [Google Apps Script](https://developers.google.com/apps-script/overview) is genuinely excellent. One line of `SpreadsheetApp` and you're on the sheet. One line of `GmailApp` and the mail is out. You don't write a single line of authentication code. No server, no cost. **If a job starts and ends inside Google, there aren't many faster paths than this.**

## Where I got stuck was the next item

The problem was the next line on the list. Announce the sent quote to a Slack channel, follow up a few days later if nobody replies, and record it somewhere else once it turns into a contract. That's the point where the automation takes one step outside Google.

And at that step the difficulty flips.

Google services are one `SpreadsheetApp.` away. Everything outside has to be wired up by hand with `UrlFetchApp`. Get a token, **implement the refresh logic yourself**, stash it in script properties, handle expiry. And that work starts over from scratch every time you build another automation. The automation itself is ten lines; the plumbing around authentication is a hundred.

In [n8n](https://n8n.io/) that becomes registering the credential **once**. n8n handles the refresh, and every workflow afterward reuses it. In practice, external integrations that used to take me two hours in Google Apps Script now take fifteen minutes.

That was the trigger. Once I started using it, more reasons showed up.

## Why the second tool stayed

### 1. When something fails, the data is still there

A Google Apps Script execution log contains whatever I remembered to put in `Logger.log`. When it fails, one email with a stack trace arrives, and that's it. **What value came in and broke it is gone.** So I add more logging, run it again, and wait for it to break again.

n8n stores **the full input and output of every step** on every run. I can open a failure from three weeks ago, look at exactly what arrived at the fifth step, fix the value, and re-run from there.

The gap in debugging time was the biggest one. Automations cost you more time to repair than to build.

### 2. At 6 minutes, the script is cut off mid-job

Google Apps Script doesn't run on your computer. **It runs on Google's servers.** You're borrowing someone else's machine for free, so Google caps how long any single run is allowed to take. That cap is **6 minutes**.

What happens at 6 minutes? No warning, and no pausing and picking up again. **It just stops in the middle of whatever it was doing.** If it was working through 100 records, you get 37 and the rest simply never happened. And the script has no memory of where it stopped.

Building and sending one quote takes seconds, so it never comes near the limit. The problem is **anything that loops over many records in one go**.

And here's the part that's easy to get wrong. If your company pays for Google Workspace, it's natural to assume this limit is gone, or at least generous. **Six minutes is identical on paid Workspace.** It is not something a higher plan unlocks.

What does change with the account type is the daily totals.

| Quota | Free Google account | Paid Workspace |
|---|---|---|
| **Runtime per execution** | **6 min** | **6 min, same** |
| Total trigger runtime per day | 90 min | 6 hours |
| Email recipients per day | 100 | 1,500 |
| URL Fetch calls per day | 20,000 | 100,000 |

The full table is on the [Google Apps Script quotas page](https://developers.google.com/apps-script/guides/services/quotas).

So the moment you write a batch that walks 500 customers, what stops you first isn't the daily total, it's **the 6 minutes on a single execution**. From there you're writing code that records how far it got so the next run can pick up where it left off. Code that has nothing to do with the job you set out to do.

n8n has no constraint like this, one that cuts an execution off on elapsed time alone.

### 3. Can you hand it to someone else?

For me this was the decisive one.

When I deliver a Google Apps Script automation, the deliverable is **code**. The owner can't open it, and the next person can't easily pick it up. From the builder's side that can look like job security.

In practice it works the other way around. **It blocks the contract.** "What happens to us if this person disappears" is the single biggest reason a small business hesitates to hire outside help. When I'm the one hiring, I hesitate for exactly the same reason.

n8n is a screen. The flow is a picture, and "move the alert from 9am to 8am" is something the owner changes themselves. Being able to see it is enough to create trust. And once there's trust, the conversation moves on to the next thing.

### 4. It isn't hanging off one Google account

Google Apps Script lives attached to a specific Google account. If that account belonged to someone who left, or if the account gets suspended, the automation disappears with it. It's easy to file that under things that don't really happen, but it does. Anything the business depends on that hangs off one personal account eventually sends you a bill.

### 5. It gives maintenance a basis you can invoice

One honest note. A Google Apps Script delivery gets read as "he wrote some code once," which makes a monthly maintenance fee awkward to bring up. n8n comes with **a running server, monitoring, and backups**, which are visible, concrete things. A monthly fee explains itself.

You might question whether that belongs in a technical decision. I think it has to. An arrangement that isn't sustainable as a business ends with the client's automation being neglected too.

## Where Google Apps Script still wins

So did I drop Google Apps Script? No. In these situations it's still the better tool.

| Situation | Why |
|---|---|
| Must react the moment a cell changes | n8n's Sheets integration polls, so there's at least a minute of lag. [Google Apps Script triggers](https://developers.google.com/apps-script/guides/triggers) fire immediately |
| Custom spreadsheet functions | Not possible in n8n |
| Detailed work in Docs and Slides | The Google Apps Script API goes much deeper |
| Zero server cost is non-negotiable | For a very small operation that's a fair call |
| Logic complex enough to pass 50 nodes | Past that point, code is better |
| A sidebar or dialog inside the sheet | Google Apps Script only |

The first row matters most here. It's exactly why the quote-sending automation stays in Google Apps Script. It has to react the instant a status changes in the sheet, and for that Google Apps Script wins outright.

## In practice, I use both

I settled on this boundary.

> **Google Apps Script for work "inside" the spreadsheet.**
> **n8n for work "between" systems.**

In use, that line holds up cleanly. And you can mix them. Have Google Apps Script call an n8n webhook with `UrlFetchApp`, and you get instant reaction to a sheet edit while n8n handles the outside integrations. That's how you dodge the one minute lag from the first row of the table above.

I didn't switch tools. I **split the roles**. There's no reason to tear up something that already works.

## The one thing that trips up Google Apps Script people

One place everyone gets stuck at the start, so it's worth writing down.

In Google Apps Script you write `for (const row of rows)`. **You control the loop.** In n8n, if the previous step emits 3 items, **the next step just runs 3 times on its own.** There is no loop statement.

That's lovely right up until you want to take everything at once and compute a total. The answer is the [Aggregate node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.aggregate/) and the Merge node, which collect scattered items back into one.

The more code you've written, the stranger the missing loop feels. It's worth getting that instinct straight before you start.

## So

What I confirmed this time wasn't which tool is better. It was **whether the result can be handed to someone else.**

Two posts back I wrote about [a neglected website](/en/posts/wix-to-cloudflare/). It sat untouched for years not because the skill was missing, but because touching it was frightening. Automations end up in the same place. An automation that runs well but that nobody except its author can open eventually becomes the same object as that neglected website. No problem at all while it runs, and a problem on the day it needs a change.

So now I look at two things at once. Is this working today? And **does it keep working without me?**

The next link will be about a workflow I actually built.
