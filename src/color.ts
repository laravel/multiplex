import styles, {
    type ForegroundColorName,
    foregroundColorNames,
} from "ansi-styles";

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const DEFAULT_COLORS = [
    "#93c5fd",
    "#c4b5fd",
    "#fb7185",
    "#fdba74",
    "#86efac",
    "#fcd34d",
];

type Rgb = [number, number, number];

/**
 * The names we accept, and the escape each one writes, both taken from
 * ansi-styles rather than restated here.
 *
 * This is the same list Ink resolves against: Ink colors through chalk, and
 * chalk builds its foreground methods from exactly these names. Hand-typing the
 * list would have left the two free to disagree, and a name we accept that chalk
 * does not know colors the stream label while silently leaving the sidebar plain.
 */
export const COLOR_NAMES: readonly ForegroundColorName[] = foregroundColorNames;

const NAMES = new Set<string>(COLOR_NAMES);

const isColorName = (color: string): color is ForegroundColorName =>
    NAMES.has(color);

/**
 * Roughly what the named colors look like, for contrastText alone.
 *
 * The one thing neither chalk nor ansi-styles can tell us, and not an oversight
 * on their part: `red` means whatever red the user's terminal theme defines, so
 * there is no true value to look up. These are the xterm defaults, close enough
 * to choose black or white text — being a shade out only changes the answer for
 * a background already sitting on the crossover. Nothing else may read them: a
 * name reaches the terminal as its own escape, never as this RGB.
 *
 * Typed against ForegroundColorName so it has to stay exhaustive. If ansi-styles
 * ever grows a name, this fails to compile instead of quietly defaulting.
 */
const NAME_RGB: Record<ForegroundColorName, Rgb> = {
    black: [0, 0, 0],
    red: [205, 0, 0],
    green: [0, 205, 0],
    yellow: [205, 205, 0],
    blue: [0, 0, 238],
    magenta: [205, 0, 205],
    cyan: [0, 205, 205],
    white: [229, 229, 229],
    blackBright: [127, 127, 127],
    gray: [127, 127, 127],
    grey: [127, 127, 127],
    redBright: [255, 0, 0],
    greenBright: [0, 255, 0],
    yellowBright: [255, 255, 0],
    blueBright: [92, 92, 255],
    magentaBright: [255, 0, 255],
    cyanBright: [0, 255, 255],
    whiteBright: [255, 255, 255],
};

const CANONICAL_NAMES = new Map<string, ForegroundColorName>(
    COLOR_NAMES.map((name) => [name.toLowerCase(), name]),
);

export const hexToRgb = (hex: string): Rgb => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
];

/**
 * The one gate for every color that reaches us, returning the single form the
 * rest of the code stores: hex lowercased, a name in the casing chalk expects.
 * Canonicalizing the case is not cosmetic — the old blanket `toLowerCase()`
 * would turn `redBright` into `redbright`, which chalk does not know, so Ink
 * would quietly drop the color while the stream label kept it.
 *
 * Returns undefined for anything invalid, so callers validate and normalize in
 * one step and cannot accidentally store a raw value.
 */
export function normalizeColor(value: string): string | undefined {
    if (HEX_COLOR.test(value)) {
        return value.toLowerCase();
    }

    return CANONICAL_NAMES.get(value.toLowerCase());
}

/**
 * The SGR sequence that turns the foreground on, for a normalized color.
 *
 * A name writes its own code so it picks up the theme's idea of the color; only
 * hex is resolved to truecolor, because a hex value has asked for one exact color.
 */
export function colorOpen(color: string): string {
    if (isColorName(color)) {
        return styles.color[color].open;
    }

    const [r, g, b] = hexToRgb(color);

    return `\x1b[38;2;${r};${g};${b}m`;
}

const srgbToLinear = (channel: number) => {
    const n = channel / 255;

    return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
};

const relativeLuminance = ([r, g, b]: Rgb) =>
    0.2126 * srgbToLinear(r) +
    0.7152 * srgbToLinear(g) +
    0.0722 * srgbToLinear(b);

// The luminance where black and white text score an identical WCAG contrast
// ratio against the same background: solve (L + 0.05) / 0.05 = 1.05 / (L + 0.05).
// Derived rather than eyeballed so the built-in pastels keep the black labels
// they have always had, while `blue` or `#1e1b4b` get white ones.
const CONTRAST_CROSSOVER = 0.1791;

/**
 * Black or white, whichever is legible on the given background. The sidebar
 * fills the selected tab with the command's color, which was safe to hard-code
 * black on only while every color came from a palette of light pastels.
 */
export function contrastText(background: string): string {
    const rgb = isColorName(background)
        ? NAME_RGB[background]
        : hexToRgb(background);

    return relativeLuminance(rgb) > CONTRAST_CROSSOVER ? "#000000" : "#ffffff";
}
