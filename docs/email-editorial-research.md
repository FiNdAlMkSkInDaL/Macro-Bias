# Email voice and editorial research

Macro Bias emails should sound like a concise market note from someone who checked the numbers and has a useful reading of them. Lead with the day's point, show the evidence, name what weakens it, and stop. A quiet day can produce a quiet note.

The research supports changing the structure and substance of the writing, as well as its vocabulary. The principles below are editorial decisions informed by the evidence; they are not a scientifically validated formula for making automated text indistinguishable from human writing. Sources were reviewed on 6 October 2026.

## What makes generated prose feel generic

### Grammatical habits matter

Reinhart and colleagues compared human continuations with outputs from GPT-4o, GPT-4o Mini and four Llama 3 variants using 66 linguistic features across two parallel corpora. Instruction-tuned models favoured noun-heavy constructions, nominalizations and participial clauses. GPT-4o used present participial clauses 5.3 times the human rate in this experiment. These are corpus findings from approximately 500-word continuations, rather than rules about every short email or every current model. [PNAS, February 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC11874169/).

For Macro Bias, revise sentences such as “a divergence is emerging, highlighting the importance of monitoring confirmation” into the actual observation and its consequence. “BTC fell 0.80%. The latest daily move goes against the model reading.” Removing an inflated noun without clarifying the relationship is not enough.

### Repeated polishing can flatten a voice

Sourati and colleagues examined more than 880,000 texts across seven datasets and three studies. Controlled rewrites retained core meaning but generally reduced variation in writing complexity; the paper reports significant reductions of 21–50% across datasets and models. This is a measure of variation across texts, not evidence that every rewrite makes an individual sentence worse. The controlled rewriting results are more relevant here than the observational adoption estimates, which depend on detecting generated text. [Nature Human Behaviour, 24 August 2026](https://www.nature.com/articles/s41562-026-02550-0).

The practical choice is to avoid a second polishing pass that turns every issue into the same smooth report. Keep the different kinds of day visible. A small neutral score, a strong score opposed by prices, an event override and missing data deserve different leads and different amounts of explanation.

### Word lists catch only part of the problem

Kobak and colleagues studied more than 15 million biomedical abstracts and identified an abrupt increase in stylistic vocabulary after LLM adoption. The method estimates aggregate changes; it cannot establish the authorship of an individual abstract or distinguish direct generation from humans adopting similar language. It is evidence that a register can spread, rather than a licence to accuse a writer based on a word. [Science Advances, July 2025, author text](https://arxiv.org/html/2406.07016v5).

Words such as “underscores,” “nuanced,” “robust” and “landscape” deserve attention when they add authority without meaning. Technical terms remain useful when they name something we measure. “Momentum” and “percentile” are not defects merely because models also use them. The edit should answer what the sentence contributes.

### Synonym variety does not create a point of view

Guo and colleagues benchmarked lexical, syntactic and semantic diversity across six model families and five tasks. These types of diversity did not move together. Higher temperature primarily increased lexical diversity; a generic creativity instruction had little effect in their story experiment. Their detailed deployment results concern stories and mostly smaller models, so they do not directly predict email performance. [TACL, November 2025](https://aclanthology.org/2025.tacl-1.69/).

We should keep accurate ordinary words, including repeated “rose” or “fell,” instead of rotating decorative synonyms. We should not raise generation randomness to make market copy appear raw. Useful variation comes from selecting the day's evidence and explaining its particular relationship to the score.

### Examples help but do not replace editing

Wang and colleagues evaluated style imitation using more than 400 authors across email, news, forums and blogs. Models handled structured genres better than subtle informal voice but often returned towards a generic tone; additional examples did not consistently solve the problem. These were computational evaluations without a large human reader study. [EMNLP Findings, November 2025](https://aclanthology.org/2025.findings-emnlp.532/).

The shared prompt therefore includes examples alongside concrete decisions: choose a supported lead, separate a fact from an interpretation, remove repetition and retain specific uncertainty. Examples illustrate the treatment of supplied facts. Their figures must never become inputs for a new issue.

### Experienced readers notice the whole article

Russell and colleagues collected judgements on 300 English nonfiction articles. A selected group of five experienced writers and editors identified nearly all of the generated articles. Their explanations discussed repetitive structures, overly regular formatting and quotations, inflated wording, unnecessary detail and tidy conclusions. One reviewer was misled by superficial informality. This was an upper-bound experiment with selected experts and specific models, not an estimate for our subscribers. The explanations are qualitative observations, not universal causal rules. [ACL, July 2025](https://aclanthology.org/2025.acl-long.267/).

Contractions can make a sentence natural, but adding “honestly,” slang or a personal anecdote does not fix an empty paragraph. Review several email issues together. A single attractive sample can conceal identical openings and caveats across a week.

### Punctuation and detector scores are poor acceptance criteria

Xia, Stanczak and Roth examined detector generalization across 516,000 texts, seven LLMs, six prompts and four domains. Performance often degraded when domains, prompts or models changed, and linguistic correlates varied by setting. This concerns two classifier architectures and selected English domains; it does not prove detection is always impossible. [EACL, March 2026](https://aclanthology.org/2026.eacl-long.307/).

An earlier six-model news comparison also found differences in sentence-length distributions and syntax, while using older base models and one news source. That dependence on genre and model is a reason to avoid universal claims about “burstiness.” [Muñoz-Ortiz and colleagues, Artificial Intelligence Review, August 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC11422446/).

We will assess usefulness, accuracy and editorial quality. We will not insert typos, force alternating sentence lengths, ban punctuation as an authorship test, or use an AI-detector percentage as a release gate.

## What helps readers

### Concrete detail must answer their question

Packard and Berger's five studies used customer-service field interactions and experiments. Concrete language made employees seem more attentive, but irrelevant concrete detail did not provide the same benefit. These are customer-service results, not a demonstrated increase in market-newsletter retention or revenue. [Journal of Consumer Research, online July 2020, February 2021 issue](https://doi.org/10.1093/jcr/ucaa038).

For this email, useful specificity identifies the asset, observed change, comparison baseline, date and horizon. A long list of numbers is still poor copy if it leaves the reader to find the point. A measured difference in ETH's daily return belongs beside the BTC comparison; an unmeasured account of all altcoins does not.

### Ordinary language can carry expertise

Oppenheimer's experiments found that needless verbal complexity reduced judgements of an author's intelligence, with processing fluency mediating the effect. This measured perceived intelligence, not authorship, accuracy or email engagement. It does not imply that all long words or specialist terms should disappear. [Applied Cognitive Psychology, online October 2005, March 2006 issue](https://onlinelibrary.wiley.com/doi/10.1002/acp.1178).

GOV.UK's current guidance recommends plain language even for specialists, active verbs, useful structure and a serious conversational tone. These are editorial conventions for public services. Macro Bias can use ordinary contractions and financial terms where they help this audience. [Clear language](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/clear-language/), [right tone](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/right-tone/), [clear structure](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/clear-structure/).

### Uncertainty needs a cause

Van der Bles and colleagues ran five experiments involving 5,780 participants, including a BBC field experiment. Numerical uncertainty ranges generally produced little loss of trust compared with verbal uncertainty. The studies concerned uncertainty about measurable facts in UK audiences, rather than future financial returns. They do not establish that disclosing uncertainty always increases trust. [PNAS, March 2020](https://pubmed.ncbi.nlm.nih.gov/32205438/).

We can say “Five past sessions matched this setup” and show their observed return range. We must distinguish that spread from a predictive confidence interval. Historical match quality, agreement within a small set and the chance of a future gain remain different quantities. A specific limit is more useful than three vague sentences saying markets are uncertain.

### Stable voice can accommodate different days

Mailchimp distinguishes a stable brand voice from tone that changes with the situation. Its guidance puts clarity ahead of entertainment and advises against forced jokes. Its newsletter guidance favours descriptive subjects, useful preheaders, concise paragraphs and reading aloud. These are company conventions, not experimental proof of human authenticity. [Voice and tone](https://styleguide.mailchimp.com/voice-and-tone/), [email newsletters](https://styleguide.mailchimp.com/writing-email-newsletters/).

Older web usability experiments found benefits from concise, scannable and objective writing. They tested particular websites and tasks in the 1990s, so their percentages should not become promises about modern email engagement. The transferable preference is to put the useful point first and remove promotional burden. [Morkes and Nielsen, 1997](https://www.nngroup.com/articles/concise-scannable-and-objective-how-to-write-for-the-web/).

## The Macro Bias editorial standard

The voice is direct, calm and sceptical of hype. The reader should feel that someone attended to this day's evidence. Confidence should come from the accuracy of the reasoning, not from polished certainty.

1. **Lead with one useful point.** Pick the supported change, contradiction or absence of direction. Do not open with a generic scene or a repeated “Pattern intact” tag.
2. **Separate facts from the reading.** A daily price move is observed. A historical model tendency is a different claim. State their relationship without inventing a cause.
3. **Use concrete subjects and ordinary verbs.** Assets rise or fall. The score changes. A feed is unavailable. Do not turn these into noun-heavy abstractions.
4. **Keep a restrained position.** Explain what the evidence supports and what works against it. A conditional model playbook is not observed sector leadership.
5. **Let length follow substance.** Stable parser headers can coexist with one short sentence in one section and a fuller explanation in another. Do not fill a quota with a second summary.
6. **Keep uncertainty local and precise.** Preserve a weak-match warning, the actual sample and its recorded horizons. State material missing coverage clearly once.
7. **Use natural rhythm.** Permit contractions and short sentences. Do not require slang, fragments, typos or arbitrary punctuation changes.
8. **Keep provenance honest.** “We do not measure exchange flows” describes the service. “I stayed out of the market this morning” invents a person's trading decision. No fictional author, quote, feeling, experience or portfolio.
9. **Stop when the point is made.** No mandatory upbeat ending or recap of what the reader just read.
10. **Check several issues together.** Look for repeated openings, mirrored paragraphs, boilerplate that overwhelms different facts, and an identical emotional tone on different kinds of day.

## Examples using recorded October 5 data

These examples illustrate style with existing data. They do not describe tomorrow's prices or score.

| Existing wording | Clearer treatment of the same evidence |
| --- | --- |
| The historical model leans strongly positive; BTC moved -0.80%, opposite to the model lean. | BTC fell 0.80%. The model gives a strongly positive reading. The latest daily move goes against it. |
| The 5 matched historical sessions: weighted BTC returns averaged… | Five past sessions matched this setup. BTC's weighted average return was +1.83% after one day and +4.02% after three days. |
| The score deserves weight today. | The score is +72. BTC, ETH and SOL all fell on the latest completed day. The positive model reading has no support from those daily moves. |
| Stablecoins/Flows: Neutral. | Exchange flows, stablecoin supply and pegs are not measured here. |

The full note must retain the observed historical ranges and the distinction between historical fit and the probability of a gain. A cleaner sentence cannot strengthen the claim beyond its evidence.

## How the standard reaches future emails

The shared guidance lives in `src/lib/briefing/editorial-voice.ts`. Both stock and crypto future prompts use it. Deterministic fallback and context strings follow the same standard, because they produce much of the delivered email even when an LLM is available. Internal parser headers remain stable; visible section labels use ordinary reader language.

The existing 7 October 2026 London activation controls the change. Historical published rows, model calculations, delivery claims, recipients, unsubscribe handling and free/paid access remain governed by their existing contracts. No extra rewrite model is inserted into the publishing job.

Automated checks cover dates, factual figures, observed horizons, missing data, weak matches, overrides, tier access, escaping and delivery behavior. Qualitative review compares positive, negative, neutral and incomplete readings. Those checks establish editorial and factual behavior; they do not establish human authorship or subscriber preference. Future reader replies and clicks can inform further edits, while open rates alone should not be treated as a clean measure of writing quality.
