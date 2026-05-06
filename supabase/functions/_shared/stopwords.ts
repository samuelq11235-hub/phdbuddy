// Minimal stopword lists for the two languages researchers using
// PHDBuddy most commonly mix (Spanish + English). Borrowed from the
// classic snowball lists, trimmed to high-frequency tokens.
//
// Kept in this shared file so word-frequency, KWIC, and any future
// IR-style features can reuse the same vocabulary.

const ES = `a al algo algun alguna algunas alguno algunos ante antes aquel aquella aquellas aquellos aqui asi aun aunque cada como con contra cual cuales cualquier cuando cuanto cuyo de del demas desde dia donde dos durante e el ella ellas ellos en entre era eran eras eres es esa esas ese esos esta estaba estaban estamos estan estar estas este estes esto estos estoy fue fueron fui fuimos ha haber habia habian habido hace hacer han has hasta hay he la las le les lo los me mi mis mismo mismos modo mucha muchas mucho muchos muy nada ni no nos nosotros nuestra nuestras nuestro nuestros o os otra otras otro otros para pero por porque pues que quien quienes se sea sean ser si sido siempre sin sino sobre sois soy su sus tan te tendra tendran tendre tendremos tendria tendrian tener tengo ti tiene tienen toda todas todo todos tras tu tus un una unas uno unos vosotros vuestra vuestras vuestro vuestros y ya yo`;

const EN = `a about above after again against all am an and any are aren't as at be because been before being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves`;

const ALL = new Set<string>(
  [...ES.split(/\s+/), ...EN.split(/\s+/)].filter(Boolean).map((w) => w.toLowerCase())
);

export function isStopword(token: string): boolean {
  return ALL.has(token);
}

export function tokenize(text: string): string[] {
  // Lower-case + split on anything that's not a letter (incl. accented),
  // digit, or apostrophe. Drops punctuation and isolated digits/numbers
  // because pure numbers rarely tell us anything in qualitative work.
  // \p{L} requires the `u` flag.
  const matches = text.toLowerCase().match(/[\p{L}][\p{L}\p{M}'-]+/gu);
  if (!matches) return [];
  return matches.filter((t) => t.length >= 3 && !isStopword(t));
}
