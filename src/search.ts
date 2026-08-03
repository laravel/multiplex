const MATCH_BG = "\x1b[48;2;80;80;0m";
const CURRENT_MATCH_BG = "\x1b[48;2;160;120;0m";
const RESET_BG = "\x1b[49m";

export interface SearchResult {
    result: string;
    count: number;
    linePositions: number[];
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

export function highlightSearch(
    raw: string,
    query: string,
    activeMatchIdx: number,
): SearchResult {
    if (!query) {
        return { result: raw, count: 0, linePositions: [] };
    }

    const segments = parseSegments(raw);

    const plainParts: string[] = [];
    for (const seg of segments) {
        if (!seg.isAnsi) {
            plainParts.push(seg.text);
        }
    }
    const plainText = plainParts.join("");

    const lowerPlain = plainText.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const matches: [number, number][] = [];
    let pos = 0;
    while ((pos = lowerPlain.indexOf(lowerQuery, pos)) !== -1) {
        matches.push([pos, pos + query.length]);
        pos++;
    }

    if (matches.length === 0) {
        return { result: raw, count: 0, linePositions: [] };
    }

    const linePositions = matches.map(([start]) => {
        let line = 0;
        for (let i = 0; i < start; i++) {
            if (plainText[i] === "\n") {
                line++;
            }
        }
        return line;
    });

    const boundaries = new Set<number>();
    for (const [ms, me] of matches) {
        boundaries.add(ms);
        boundaries.add(me);
    }

    function matchAt(p: number): number {
        for (let i = 0; i < matches.length; i++) {
            if (p >= matches[i][0] && p < matches[i][1]) {
                return i;
            }
        }
        return -1;
    }

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

        const unique = [...new Set(splitPoints)];

        for (let s = 0; s < unique.length - 1; s++) {
            const start = unique[s];
            const end = unique[s + 1];
            if (start === end) {
                continue;
            }

            const text = seg.text.slice(start, end);
            const mi = matchAt(plainPos + start);

            if (mi !== -1) {
                const bg = mi === activeMatchIdx ? CURRENT_MATCH_BG : MATCH_BG;
                result += bg + text + RESET_BG;
            } else {
                result += text;
            }
        }

        plainPos += textLen;
    }

    return { result, count: matches.length, linePositions };
}
