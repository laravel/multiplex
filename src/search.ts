const MATCH_BG = "\x1b[48;2;80;80;0m";
const CURRENT_MATCH_BG = "\x1b[48;2;160;120;0m";
const RESET_BG = "\x1b[49m";

// Must drop exactly what parseSegments leaves out of its plain text, or match
// offsets drift between the two.
const STRIP_PATTERN = /\x1b\[[0-9;]*[A-Za-z]|\x1b|\r/g;

export interface SearchIndex {
    count: number;
    lineOf: number[];
    firstMatchOnLine: Map<number, number>;
}

interface Segment {
    text: string;
    isAnsi: boolean;
}

function parseSegments(raw: string): Segment[] {
    const segments: Segment[] = [];
    const regex = /(\x1b\[[0-9;]*[A-Za-z])|([^\x1b\r]+)/g;
    let match: RegExpExecArray | null = null;

    while ((match = regex.exec(raw)) !== null) {
        if (match[1]) {
            segments.push({ text: match[1], isAnsi: true });
        } else if (match[2]) {
            segments.push({ text: match[2], isAnsi: false });
        }
    }

    return segments;
}

// Safe to share the global regex: replace() resets lastIndex on every call.
export function stripAnsi(raw: string): string {
    return raw.replace(STRIP_PATTERN, "");
}

function findMatches(plain: string, query: string): [number, number][] {
    const lowerPlain = plain.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const matches: [number, number][] = [];
    let pos = lowerPlain.indexOf(lowerQuery);

    while (pos !== -1) {
        matches.push([pos, pos + query.length]);
        pos = lowerPlain.indexOf(lowerQuery, pos + 1);
    }

    return matches;
}

export function indexMatches(lines: string[], query: string): SearchIndex {
    const index: SearchIndex = {
        count: 0,
        lineOf: [],
        firstMatchOnLine: new Map(),
    };

    if (!query) {
        return index;
    }

    const lowerQuery = query.toLowerCase();

    for (let i = 0; i < lines.length; i++) {
        const plain = stripAnsi(lines[i]).toLowerCase();
        let pos = plain.indexOf(lowerQuery);

        if (pos === -1) {
            continue;
        }

        index.firstMatchOnLine.set(i, index.lineOf.length);

        while (pos !== -1) {
            index.lineOf.push(i);
            pos = plain.indexOf(lowerQuery, pos + 1);
        }
    }

    index.count = index.lineOf.length;

    return index;
}

// firstMatchIdx is the index of this line's first match within the buffer-wide
// index, which is what makes activeMatchIdx comparable here.
export function highlightLine(
    raw: string,
    query: string,
    activeMatchIdx: number,
    firstMatchIdx: number,
): string {
    if (!query) {
        return raw;
    }

    const segments = parseSegments(raw);

    let plainText = "";

    for (const seg of segments) {
        if (!seg.isAnsi) {
            plainText += seg.text;
        }
    }

    const matches = findMatches(plainText, query);

    if (matches.length === 0) {
        return raw;
    }

    const boundaries = new Set<number>();

    for (const [start, end] of matches) {
        boundaries.add(start);
        boundaries.add(end);
    }

    let cursor = 0;

    // Correct only because p never moves left and matches share a length:
    // one forward-only cursor then finds the first match covering p.
    const matchAt = (p: number): number => {
        while (cursor < matches.length && matches[cursor][1] <= p) {
            cursor++;
        }

        return cursor < matches.length && matches[cursor][0] <= p ? cursor : -1;
    };

    let result = "";
    let plainPos = 0;

    for (const seg of segments) {
        if (seg.isAnsi) {
            result += seg.text;
            continue;
        }

        const textLen = seg.text.length;
        const splitPoints = [0];

        for (const b of boundaries) {
            const rel = b - plainPos;

            if (rel > 0 && rel < textLen) {
                splitPoints.push(rel);
            }
        }

        splitPoints.push(textLen);
        splitPoints.sort((a, b) => a - b);

        for (let s = 0; s < splitPoints.length - 1; s++) {
            const start = splitPoints[s];
            const end = splitPoints[s + 1];

            if (start === end) {
                continue;
            }

            const text = seg.text.slice(start, end);
            const mi = matchAt(plainPos + start);

            if (mi === -1) {
                result += text;
                continue;
            }

            const bg =
                firstMatchIdx + mi === activeMatchIdx
                    ? CURRENT_MATCH_BG
                    : MATCH_BG;

            result += bg + text + RESET_BG;
        }

        plainPos += textLen;
    }

    return result;
}
