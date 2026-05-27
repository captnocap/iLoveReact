// gallery-builders.ts
//
// Intent-shaped factories for classifier defs. Each builder collapses a
// recurring visual idiom into one call so the cls sheet reads as design
// intent rather than style soup.
//
// Pairs with the runtime's `.Suffix` appendage shorthand in
// `runtime/classifier.tsx`: builder result + `'.Variant': { delta }` gives
// the densest possible expression of a component family.

import type {
    ColorToken, SpaceToken, RadiusToken, TypeToken, FontToken,
} from './gallery-tokens';
import { padXY } from './gallery-style';

/** Themed text rung. */
export const text = (
    size: TypeToken | number,
    color: ColorToken,
    opts: {
        bold?: boolean;
        font?: FontToken;
        lineHeight?: number;
        letterSpacing?: number | string;
        pre?: boolean;
        italic?: boolean;
        align?: 'left' | 'right' | 'center';
        numberOfLines?: number;
    } = {},
) => {
    const style: Record<string, unknown> = {};
    if (opts.font) style.fontFamily = opts.font;
    if (opts.lineHeight !== undefined) style.lineHeight = opts.lineHeight;
    if (opts.letterSpacing !== undefined) style.letterSpacing = opts.letterSpacing;
    if (opts.pre) style.whiteSpace = 'pre';
    if (opts.italic) style.fontStyle = 'italic';
    if (opts.align) style.textAlign = opts.align;
    return {
        type: 'Text' as const,
        size, color,
        ...(opts.bold ? { bold: true } : {}),
        ...(opts.numberOfLines ? { numberOfLines: opts.numberOfLines } : {}),
        ...(Object.keys(style).length ? { style } : {}),
    };
};

/** Mono text — most chrome lives here. */
export const monoText = (
    size: TypeToken | number,
    color: ColorToken,
    opts: Omit<Parameters<typeof text>[2], 'font'> = {},
) => text(size, color, { ...opts, font: 'theme:fontMono', pre: opts.pre ?? true });

/** Pill/badge body with optional bg. Same x3/x1 pad, sm-rounded, with
 *  the standard light → rounded / dark → square variants. */
export const badge = (bg: ColorToken) => ({
    type: 'Box' as const,
    style: {
        ...padXY('theme:spaceX3', 'theme:spaceX1'),
        borderRadius: 'theme:radiusSm' as RadiusToken,
        backgroundColor: bg,
    },
    variants: {
        light: { style: {
            paddingLeft: 'theme:spaceX4', paddingRight: 'theme:spaceX4',
            borderRadius: 'theme:radiusRound',
        } },
        dark: { style: { borderRadius: 'theme:radiusSm' } },
    },
});

/** Status dot — fixed 6×6 pill, one color per state. */
export const statusDot = (bg: ColorToken, size = 6) => ({
    type: 'Box' as const,
    style: {
        width: size, height: size,
        borderRadius: 'theme:radiusPill' as RadiusToken,
        backgroundColor: bg,
    },
});

/** Width × height square with bg (used by step cubes, swatches). */
export const swatch = (w: number, h: number, bg: ColorToken) => ({
    type: 'Pressable' as const,
    style: { width: w, height: h, backgroundColor: bg },
});

/** 1px divider in either axis. */
export const divider = (axis: 'h' | 'v', color: ColorToken = 'theme:rule') => ({
    type: 'Box' as const,
    style: {
        [axis === 'h' ? 'height' : 'width']: 1,
        flexShrink: 0,
        backgroundColor: color,
    },
});

/** Stack (column) with a single gap token. */
export const stack = (gap: SpaceToken, opts: { center?: boolean } = {}) => ({
    type: 'Box' as const,
    style: {
        ...(opts.center ? { alignItems: 'center' as const } : {}),
        gap,
    },
});

/** Inline (row) with gap. */
export const inline = (
    gap: SpaceToken,
    opts: {
        align?: 'center' | 'stretch' | 'flex-start' | 'flex-end';
        justify?: 'space-between' | 'flex-end' | 'center';
        wrap?: boolean;
    } = {},
) => ({
    type: 'Box' as const,
    style: {
        flexDirection: 'row' as const,
        alignItems: opts.align ?? 'center',
        ...(opts.justify ? { justifyContent: opts.justify } : {}),
        ...(opts.wrap ? { flexWrap: 'wrap' as const } : {}),
        gap,
    },
});

/** Pill with a fixed height and centered content — what AppChatStatusPill
 *  needs (the generic badge() builder defaults aren't quite right). */
export const fixedPill = (opts: {
    height: number;
    padX: SpaceToken | number;
    border: ColorToken;
    bg?: ColorToken;
}) => ({
    type: 'Box' as const,
    style: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        height: opts.height,
        paddingLeft: opts.padX, paddingRight: opts.padX,
        borderWidth: 1, borderColor: opts.border,
        backgroundColor: opts.bg ?? ('theme:bg' as ColorToken),
    },
});
