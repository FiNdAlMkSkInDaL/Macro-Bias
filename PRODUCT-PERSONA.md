# Macro Bias -- Product Persona & Brand Voice

This document defines exactly how Macro Bias communicates across every surface: emails, social posts, blog articles, UI copy, and marketing. Every piece of content we publish should feel like it was written by the same person.

---

## Who We Are

Macro Bias is a daily market intelligence product for active traders and self-directed investors. We use a quantitative model (K-NN pattern matching across macro data) to give subscribers a directional read on the market each morning before they trade.

We are not a hedge fund. We are not selling courses. We are not financial advisors. We are a sharp, data-driven daily briefing that helps people trade with more context than they had yesterday.

---

## The Voice

**Think:** A sharp, experienced trader explaining the day to a friend who also trades. Not lecturing. Not selling. Just talking straight.

### Principles

1. **Plain English, always.** If a sentence needs a glossary, rewrite it. Technical terms are fine when they're common knowledge among active traders (RSI, VIX, DXY, SPY). But never use jargon to sound smart.

2. **Confident, not arrogant.** We know the data. We trust the model. We don't hedge every sentence with "maybe" or "possibly." But we also don't pretend we're never wrong. When we're unsure, we say so directly.

3. **Conversational, not casual.** We write like adults talking to adults. Contractions are fine. Short sentences are fine. But we don't use slang, memes, or try to be funny for the sake of it.

4. **Accessible, not dumbed down.** A retail trader with 6 months of experience should be able to read our briefing and understand what the market is doing. A 20-year veteran should read the same briefing and respect the analysis.

5. **Authoritative, not preachy.** We don't tell people what to do. We show them what the data says and what similar conditions have led to historically. They make their own decisions.

---

## Formatting Rules

### Never Use
- **Em-dashes** ( -- or the unicode character). Use commas, periods, or colons instead.
- **Markdown bold in social posts** (no `**TICKER**`). Tickers are plain text on X and Bluesky.
- **Exclamation marks** in analysis. (Fine sparingly in marketing/social, never in the briefing itself.)
- **Semicolons.** Use two sentences instead.

### Sentence Structure
- Vary sentence length. Mix short punchy lines with longer explanatory ones.
- Lead with the insight, not the setup. Say what matters first.
- No run-on sentences. If it needs a breath, split it.

### Paragraph Structure
- Short paragraphs. 2-4 sentences max in emails and articles.
- One idea per paragraph.
- Use line breaks generously in emails. White space is your friend.

---

## Banned Words & Phrases

These words are either AI slop, crypto-bro culture, or institutional cosplay. Never use them:

| Banned | Why | Use Instead |
|--------|-----|-------------|
| "protocol" (as noun for our system) | Sounds like a sci-fi movie | "model", "system", "the data" |
| "institutional flow" | We don't have order flow data | "buyers", "demand", "bids stepping in" |
| "retail trap" | Condescending to our audience | "crowded trade", "consensus is wrong" |
| "algorithmic edge" | Overpromises | "data-driven read", "historical pattern" |
| "regime shift" (without context) | Meaningless to most readers | "the market character changed" or explain what shifted |
| "delve" | AI tells on itself | Just say "look at" or "dig into" |
| "tapestry" | AI slop | Remove entirely |
| "testament" | AI slop | "proof", "evidence", "shows" |
| "landscape" | AI slop | "market", "environment", "conditions" |
| "navigate" | AI slop | "trade through", "handle", "deal with" |
| "leverage" (as verb) | Consultant speak | "use" |
| "utilize" | Just say "use" | "use" |
| "robust" | Meaningless filler | Be specific about what makes it strong |
| "cutting-edge" | Marketing cliche | Drop it |
| "Check our bio link" | Spammy CTA | "macro-bias.com/emails" or nothing |

---

## Channel-Specific Guidelines

### Daily Email Briefing
- Written by AI (Claude) with the prompt in `daily-briefing-config.ts`.
- Sections: BOTTOM LINE, SECTOR BREAKDOWN, RISK CHECK, MODEL NOTES.
- Tone: Direct, analytical, no fluff. Like a morning note from a macro desk.
- Length: 400-600 words. Readable in 90 seconds.
- Tickers can be bold in email (Markdown rendering supports it).
- No em-dashes. No hedge words. No "it remains to be seen."
- End with a clear, actionable takeaway.

### X (Twitter) & Bluesky
- 280 character limit for X. 300 grapheme limit for Bluesky.
- Tone: FinTwit native. Like a trader posting between sessions.
- One idea per post. Don't try to summarize the whole briefing.
- Tickers as plain text: $SPY, $QQQ, $VIX. No bold, no asterisks.
- Links go at the end if included. Prefer just macro-bias.com/emails.
- No threads. Single posts only.
- No hashtags unless they're genuinely relevant (#SPY is fine, #TradingTips is not).

### Blog Articles (Intel)
- 500-800 words.
- Written for SEO but readable by humans first.
- H2 headers to break up sections.
- Conversational but substantive. Teach something real.
- End with a soft CTA that feels natural, not salesy.
- No "In this article, we will..." openings. Start with the hook.

### UI Copy
- Minimal. Get out of the way.
- Labels should be self-explanatory without tooltips.
- Error messages should be helpful, not generic.

---

## Content Philosophy

We believe:
- Data beats opinion. Always show the data.
- History rhymes. Pattern matching across similar market conditions is genuinely useful.
- Transparency builds trust. Show the model's track record, including the misses.
- Simplicity is harder than complexity. Making quant analysis accessible is the product.
- One great insight beats ten mediocre ones. Edit ruthlessly.

---

## What We Sound Like (Examples)

**Good:** "Bonds are selling off but equities haven't noticed yet. That gap usually closes within 3-5 sessions. The question is which one blinks first."

**Bad:** "The protocol has flagged a divergence in the cross-asset institutional flow regime between fixed income and equities, suggesting a potential regime shift is imminent."

**Good:** "The model matched today to 47 similar sessions. 38 of them were green the next day. Not a guarantee, but worth knowing before you press the sell button."

**Bad:** "Our cutting-edge algorithmic framework leverages historical K-NN analog analysis to navigate regime uncertainty with robust precision."

**Good (social):** "Oil just moved and nobody's talking about it. $USO is quietly repricing inflation risk while everyone watches $SPY."

**Bad (social):** "The protocol just flagged volatility compression in **$USO**. Institutional flow repricing inflationary regime. macro-bias.com/emails"

---

*Last updated: April 2025. This is a living document. Update it when the voice evolves.*
