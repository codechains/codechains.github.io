---
title: Quotes in 5 Minutes, Not a Day, With Google Apps Script
date: 2026-08-02
description: USD list prices, per-product discounts, and volume tiers kept us writing quotes by hand for years. Claude and Google Apps Script cut it to five minutes.
tags: [AI automation, AI transformation, Claude, Google Apps Script, Google Workspace]
---

After moving our two company websites [over to Cloudflare](/en/posts/wix-to-cloudflare/), I opened the list of postponed work again. The most urgent item on it was automating quote delivery.

## We were using Google Workspace as a mailbox

Our company mail runs on [Google Workspace](https://workspace.google.com/), Gmail underneath. So we already owned a fairly powerful piece of IT infrastructure.

What we actually used was sending mail and sharing files on Google Drive. That was the whole list. None of what makes Workspace actually valuable was in play.

And I suspect most companies stop right there. Paying per seat every month, using it as a mailbox and a filing cabinet.

## The real strength is Apps Script, and it kept getting pushed back

Workspace has a lot of features. The one that stands out most is [Google Apps Script](https://developers.google.com/apps-script/overview). You can build a project wired straight into the Workspace ecosystem and use it to automate real work. Sheets, Docs, Gmail, and Drive are already tied together at the point where you start.

But I never got to it. Two reasons. There weren't many examples to work from, and I didn't have the stretch of quiet time it would take to build. So it kept losing the priority argument.

## Which meant quotes worked like this

Our quote flow looked like this.

1. The customer requests a quote through a **Google Form**
2. The request lands in a **Google Sheet**
3. A notification **email** arrives
4. A person opens the mail and reads through the request
5. A person **writes the quote by hand**
6. A person sends it

Steps 1 through 3 run themselves. Steps 4 through 6, the ones that actually cost time, are all human. The automation tells you a request arrived and leaves the work exactly where it was.

If you're not paying for an external quoting service and don't have automation skills in house, I'd guess most Gmail-based companies are stopped at this same line.

## The real reason I postponed it was the quote logic

"No time" is only half true. The real reason is that our quotes are more complicated than they look.

- Our company **lists product prices in USD**. The quote that goes to the customer is in Korean won, so it has to reflect the exchange rate at the time of the request
- **Every product has a different discount rate**
- **Volume discounts differ per product** as quantities go up

Stack those three and the math on a single quote stops being simple. It isn't "look up the price list and multiply by quantity." It's genuinely awkward to automate, so a person kept doing it.

## With Claude, a few hours

This time I worked on it with Claude. It was done in a few hours, which surprised me.

### The request form moved onto our own site

The old form was a Google Form. Nothing wrong with it functionally, but the design was nothing like our website. A customer browsing our site clicks "request a quote" and gets dropped onto a Google screen. The seam shows.

As it happened, the website had just become HTML, CSS, and JS files in my own hands from the migration. So I built a new quote request form inside the site itself. The migration work paid off immediately, right here.

### Prices and discounts moved out of the code

Here's how the complicated math got solved. I put the product price table and the discount rate table into **separate Google Sheets**, and had Apps Script read those sheets to calculate the quote.

That structure matters. When a price changes or a discount policy changes, nobody has to touch code. You change a number in a sheet. The values that change most often now sit **somewhere a non-developer can manage them**.

### Live exchange rates, with three sources

The exchange rate is the heart of a won-denominated quote. I pull it live at the moment the quote is generated, from the API published by the [Export-Import Bank of Korea](https://www.koreaexim.go.kr/).

Then I added one more thing. If that source has a problem, no quote goes out at all, which is the worst way for an automation to fail. So if the first source doesn't answer, the code falls through to a second, and then a third.

This is the easy part to skip. Build only the path where everything works, and on the day it doesn't, nothing happens at all. You find out several days later.

### PDF and out, inside 5 minutes

Once the math is done, the quote is rendered to PDF and emailed to the customer. The whole chain is tuned so that **no more than five minutes** pass between the customer submitting a request and receiving the PDF.

## A day became five minutes

If you sell products, you don't need me to explain how much the speed of a quote response matters.

| | Before | After |
|---|---|---|
| Request form | Google Form | Inside our own site |
| Writing the quote | By hand | Calculated automatically |
| Exchange rate | Looked up ad hoc | Live at request time |
| Price and discount data | In someone's head and a file | Google Sheets |
| Quote format | Varied by who wrote it | Standard PDF |
| Time to reach the customer | Hours to a day | Under 5 minutes |

When it was manual, the long part wasn't writing the quote. It was **the time it sat waiting behind other work**. Busy meant half a day gone. Busier meant tomorrow. Now there is no relationship at all between how busy I am and how fast a quote goes out.

## If you're in the same spot

- If you already pay for Google Workspace, **Apps Script is included**. There's nothing new to buy
- Keep **frequently changing values like prices and discounts in a sheet, not in code**. Then nobody has to call a developer later
- If you depend on an external API, **assume the day it goes down** and write a fallback path. Automations fail quietly
- Put the quote request form **inside your own site** where you can. Fewer drop-offs, and the design holds
- **"Our logic is too complicated to automate" is worth revisiting.** The more complicated the rules, the more mistakes a human makes repeating them. That's an argument for automating, not against
- Response speed is a sales capability in itself. A quote that's a day late gives the customer a day to look elsewhere

## So

Here's what struck me. We already had the tool. We'd been paying for Google Workspace for years, and Apps Script was sitting inside it the whole time. What was missing wasn't the tool. It was **the time to sit down and turn it into code**.

That's exactly the part AI changed. Years of postponement became a few hours. The same thing that happened with the website migration, happening a second time. [When I started this record](/en/posts/why-ai-transform/) I called it the grammar of work changing. This was the second time I watched it happen to my own list.

And yet on the next item, I ended up bringing in a second tool. Why I did that while this automation was running perfectly well is [the story of adding n8n](/en/posts/google-apps-script-to-n8n/).
