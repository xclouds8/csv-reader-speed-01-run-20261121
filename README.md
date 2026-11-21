# csv-reader-speed-01-run-20261121

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)
[![Rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/xclouds8/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)
[![Reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/xclouds8/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's csv-reader 1.0.0 — entry for the make.fun
bounty **csv-reader-speed-01-run-20261121** ("Read broken CSV files faster,
21 November 2026").

## What it does

`solve.js` exports `run(input)`, which returns exactly what csv-reader 1.0.0's
`readCsv` returns for the same `{text, header}` input: the JSON value
`{columns, rows, errors}`. It reads the text once, left to right, with the
reference's broken-row policy: a U+FEFF at the very start is dropped; a record
ends at LF or CRLF and a line left with no characters is no record; outside
quotes a CR not followed by LF is dropped (`stray_cr`); a field that opens
with a quote runs to the next quote that is not doubled, `""` inside it is one
quote and each CRLF or lone CR inside it is read as LF; what follows its
closing quote, up to the next comma or line break, is appended as it stands
(`quote_junk`); a quote that never closes is a literal character and the text
after it is read again as unquoted (`unterminated_quote`); a quote inside an
unquoted field is a literal character; fields stay strings, never trimmed or
converted; `columns` is the first record when `header` is true, else null;
`rows` holds the records after it, each padded (`short_row`) or cut
(`long_row`) to the first record's width.

`main.ts` is the harness driver (kept from the kit's house baseline): it reads
every case from `/input/cases.json`, answers each one alone with `run`, and
writes `/output/answers.json`.

## Why it is faster

The reference reads one character at a time, building every field a character
at a time. This implementation scans with `indexOf` and slices whole fields
instead: a record whose first line holds no quote and no stray CR is taken in
one go and split on commas, and even records with quotes go through a
per-field reader that slices between the nearest comma or LF found by
`indexOf`. A lone CR is looked for only inside the field's own segment, never
with an unbounded scan (stray CRs are rare, so an unbounded scan would walk
far past the field on most calls). Nothing is cached from one case to the next;
every answer is computed fresh.

## Run it

```sh
node main.ts   # reads $MAKEFUN_INPUT_DIR/cases.json (default /input),
               # writes $MAKEFUN_OUTPUT_DIR/answers.json (default /output)
```

Node 22 or later, JavaScript/TypeScript source only, no dependencies, no
WebAssembly, no native addons.

## Tests (local)

- `node test.mjs` — the 6 practice cases against csv-reader 1.0.0 and the
  kit's `expected.json`, ~140 targeted edge cases (BOM, CRLF, lone CR,
  unterminated quotes, quote junk, short/long rows, empty lines, header
  true/false) and 20,000 random fuzz inputs: all identical to the reference.
- `node bench.mjs` — practice-set timing against the reference.
- Three further case sets drawn with the kit's own generator from other seeds
  also pass the kit's scorer 6/6.

## Licence

MIT — see `LICENSE`.
