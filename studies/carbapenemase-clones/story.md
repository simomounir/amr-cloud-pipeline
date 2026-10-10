---
title: Carbapenemases in high-risk K. pneumoniae clones over time
question: Which carbapenemase families travel with ST11, ST147, ST258/512 and ST307, and how has that changed since 2012?
focus: carbapenemases
---
## Background
Carbapenems are last-line antibiotics for *Klebsiella pneumoniae* infections. **Carbapenemases**
are enzymes that destroy them; the main families are KPC, NDM, OXA-48-like, VIM and IMP. Their
genes usually sit on plasmids, so they can move between strains.

A few lineages, the "high-risk clones", cause a large share of resistant infections worldwide:
ST258 (with its close relative ST512), ST11, ST147 and ST307. This study asks which carbapenemase
families each clone carries and whether that has changed over time.

The genomes are public (ENA), chosen from the Pathogenwatch collection as 13 per clone and period
(2012 or earlier, 2013–2017, 2018 or later), one per country per group, without looking at their
resistance genes. Public genomes over-represent resistant and outbreak isolates, so these shares
describe this sample, not how common each enzyme is.

## Findings
### Each clone has a signature carbapenemase {#heatmap}
ST258/512 is the KPC clone: every genome carries KPC, in every period. ST11 carries KPC in about
a third of genomes and NDM in a growing share; ST147 mostly NDM and OXA-48-like.

### ST147 switched to NDM and OXA-48-like; ST307 is gaining carbapenemases {#periods}
ST147 genomes without a carbapenemase fall from 46% (2012 or earlier) to 8% (2018 or later), while
NDM rises from 15% to 42% and the early VIM genomes disappear. ST307, best known for the CTX-M-15
ESBL, goes from 8% to 46% carbapenemase carriers. ST11 keeps KPC and doubles its NDM share.

### Where these genomes come from {#map}
55 countries, at most one genome per country in each clone and period. The map shows where
genomes were sequenced and shared, not where resistance is most common.

### The calls agree with an independent reference {#agreement}
Our sequence types agree with Pathogenwatch for 151 of 152 genomes and our carbapenemase families
for 150 of 152. One difference is a genome where we find blaGES-5, a carbapenemase the reference
table does not list.

## What this means
Each high-risk clone pairs with a characteristic carbapenemase: ST258/512 with KPC, ST147 more and
more with NDM and OXA-48-like enzymes, ST11 with both KPC and NDM. This agrees with what is widely
reported for these lineages, a useful check that public genomes re-analysed with this pipeline
recover known patterns.

The shifts over time, ST147 and ST307 gaining carbapenemases, fit carbapenemase plasmids reaching
clones that used to carry mainly ESBLs. With about 13 genomes per clone and period they are signals
in this sample, not measured trends.

The next question is whether the same clones are also gaining virulence genes: the convergence of
carbapenem resistance and hypervirulence, the subject of the next study.

## Caveats
Public genomes over-represent resistant and outbreak-associated isolates: these shares describe this cohort, not how common each enzyme is.

Each clone and period holds about 13 genomes, so one genome moves a share by roughly 8 percentage points; small differences are not meaningful.

Clone labels and collection years come from the source collection (Pathogenwatch via AMRnet); sequence types and carbapenemases are re-called by this pipeline.
