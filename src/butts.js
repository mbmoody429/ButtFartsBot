import hyphenGb from "hyphen/en-gb/index.js";

const { hyphenateSync } = hyphenGb;

// # Words that aren't funny enough to mess with
const stop = new Set(
  "a an and are as at be but by can do for from had has have he her him his how i if in is it its of on or she so than that the their them then there these they this to up was we were what when which will with would you your".split(" ")
);

// # TeX hyphenation points
function hyphenPoints(word) {
  const hyphenated = hyphenateSync(word, {
    hyphenChar: "\u00AD",
    minWordLength: 1,
  });
  const parts = hyphenated.split("\u00AD");
  const points = [];
  let offset = 0;

  for (let i = 0; i < parts.length - 1; i++) {
    offset += parts[i].length;
    points.push(offset);
  }

  return points;
}

// # Keep capitalization looking normal-ish
function replacementForCase(original, meme) {
  if (original === original.toUpperCase()) return meme.toUpperCase();
  if (/^[A-Z]/.test(original)) return meme[0].toUpperCase() + meme.slice(1).toLowerCase();
  return meme.toLowerCase();
}

// # Swap one syllable-ish chunk
function substitute(word, meme) {
  const match = word.match(/^([^A-Za-z]*)(.*?)([^A-Za-z]*)$/);
  if (!match || !match[2]) return word;

  const [, leading, actualWord, trailing] = match;
  const points = [0, ...hyphenPoints(actualWord), actualWord.length];
  const segmentCount = points.length - 1;
  const selected =
    segmentCount - 1 -
    Math.floor(Math.sqrt(Math.random() * segmentCount * segmentCount));

  let left = points[selected];
  let replaceLength = points[selected + 1] - left;

  while (actualWord[left + replaceLength] === "t") replaceLength++;
  while (left > 0 && actualWord[left - 1] === "b") {
    left--;
    replaceLength++;
  }

  const replacedSegment = actualWord.slice(left, left + replaceLength);
  let replacement = replacementForCase(replacedSegment, meme);

  if (/s$/i.test(replacedSegment)) {
    replacement += replacedSegment.endsWith("S") ? "S" : "s";
  }

  return (
    leading +
    actualWord.slice(0, left) +
    replacement +
    actualWord.slice(left + replaceLength) +
    trailing
  );
}

// # Main word replacement engine
export function buttify(text, meme = "butt") {
  const normalizedMeme = String(meme || "butt").toLowerCase();
  const parts = text.split(/(\s+)/);
  const candidates = [];

  parts.forEach((word, index) => {
    if (
      !/\s/.test(word) &&
      /[A-Za-z]/.test(word) &&
      !stop.has(word.toLowerCase()) &&
      !/^https?:\/\//i.test(word) &&
      !/^@/.test(word) &&
      word.toLowerCase() !== normalizedMeme
    ) {
      candidates.push({ index, word });
    }
  });

  candidates.sort((a, b) => b.word.length - a.word.length);
  if (!candidates.length) return text;

  let replacementCount = Math.min(
    Math.floor(parts.filter((part) => part && !/\s/.test(part)).length / 11) + 1,
    candidates.length
  );

  const weights = candidates.map(
    (_, index) => (candidates.length - index) ** 2
  );

  while (replacementCount--) {
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let random = Math.random() * total;
    let selected = 0;

    for (; selected < weights.length; selected++) {
      random -= weights[selected];
      if (random < 0) break;
    }

    parts[candidates[selected].index] = substitute(
      parts[candidates[selected].index],
      normalizedMeme
    );
    weights[selected] = 0;
  }

  return parts.join("");
}

// # Don't send useless or broken results
export function valid(original, result, meme = "butt") {
  if (
    original.replace(/\s/g, "").toLowerCase() ===
    result.replace(/\s/g, "").toLowerCase()
  ) {
    return false;
  }

  let normalized = result.replace(/[^\w]/g, "").toLowerCase();
  const normalizedMeme = String(meme || "butt").toLowerCase();

  if (normalized.endsWith("s")) normalized = normalized.slice(0, -1);
  return normalized !== normalizedMeme;
}
