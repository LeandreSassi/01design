// Reads the site's CSS custom properties so the 3D scene stays in sync with
// the 2D stylesheet. No three.js dependency on purpose.
const FALLBACK = { bg: '#126D71', text: '#ECEDF2' };

export function readTheme(root = document.documentElement) {
    const css = getComputedStyle(root);
    return {
        bg: css.getPropertyValue('--color-bg').trim() || FALLBACK.bg,
        text: css.getPropertyValue('--color-text').trim() || FALLBACK.text
    };
}
