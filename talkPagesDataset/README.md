### Candidate detector (only keeping questions between 8-280 chars)
`(?s).{8,280}\?+(\s|\n|$)`

### WH and AUX detectors (only keeping questions that start with 'wh tokens' or auxiliary-led questions, ending with a question mark
```
\b(what|who|when|where|why|how|which)\b
\b(do|does|did|is|are|was|were|can|could|should|would|isn['’]?t|doesn['’]?t|aren['’]?t|couldn['’]?t|shouldn['’]?t|wouldn['’]?t)\b
```

### Meta/media filter (these are removed) 
```
\b(see (the )?(image|picture|photo|figure|diagram|map|table|chart)|
as shown (above|below)|
(this|that|the) (image|picture|article|diagram|figure)|
(a) (source|citation)|
infobox|gallery|thumb|file:|image:|
\bRfC\b|\bAfD\b|\bRfM\b|
\bWP:[A-Z]+|MOS:|NPOV|OR|COI|SYNTH|
does this (belong|fit) here|off[- ]topic|consensus|close (this|as))\b
```
