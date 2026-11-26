import type { Config } from 'tailwindcss';

/** Colors come from CSS variables (see styles.css) so light and dark themes can swap them.
    Each variable holds "R G B", which keeps opacity modifiers like bg-accent/10 working. */
const v = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surfaces, from the page background up to floating menus
        canvas: v('canvas'),
        panel: v('panel'),
        surface: v('surface'),
        raised: v('raised'),
        border: { DEFAULT: v('border'), strong: v('border-strong') },
        // Text
        fg: { DEFAULT: v('fg'), muted: v('fg-muted'), subtle: v('fg-subtle') },
        /** Hover/press tints: white on dark, near-black on light. */
        ink: v('ink'),
        // Meaning
        accent: v('accent'),
        'on-accent': v('on-accent'),
        danger: { DEFAULT: v('danger'), solid: v('danger-solid') },
        success: v('success'),
        warning: v('warning'),
        // Timeline clips
        clip: { DEFAULT: v('clip'), hover: v('clip-hover'), selected: v('clip-selected'), border: v('clip-border') }
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif']
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }]
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        menu: 'var(--shadow-menu)'
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'pop-in': {
          from: { opacity: '0', transform: 'translateY(4px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' }
        },
        // Mobile drawers rise from the bottom edge
        'sheet-up': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' }
        },
        // Toasts arrive from above
        'drop-in': {
          from: { opacity: '0', transform: 'translateY(-12px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' }
        }
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'pop-in': 'pop-in 160ms ease-out',
        'drop-in': 'drop-in 220ms cubic-bezier(0.22, 1, 0.36, 1)',
        'sheet-up': 'sheet-up 280ms cubic-bezier(0.22, 1, 0.36, 1)'
      }
    }
  },
  plugins: []
} satisfies Config;
