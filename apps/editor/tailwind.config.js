/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#111827',
          body: '#374151',
          muted: '#4B5563',
          meta: '#6B7280',
        },
        ground: {
          DEFAULT: '#FFFFFF',
          panel: '#FAFAFA',
          sunken: '#F9FAFB',
        },
        rule: {
          DEFAULT: '#E5E7EB',
          soft: '#F3F4F6',
          strong: '#D1D5DB',
        },
        action: {
          DEFAULT: '#2563EB',
          hover: '#1D4ED8',
          soft: '#EFF6FF',
        },
        ok: { ink: '#047857', bg: '#ECFDF5' },
        warn: { ink: '#B45309', bg: '#FFFBEB' },
        danger: { ink: '#B91C1C', bg: '#FEF2F2' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        micro: ['11.5px', { lineHeight: '16px' }],
        meta: ['12.5px', { lineHeight: '18px' }],
        body: ['13.5px', { lineHeight: '20px' }],
        title: ['21px', { lineHeight: '28px', letterSpacing: '-0.02em' }],
        figure: ['22px', { lineHeight: '26px', letterSpacing: '-0.02em' }],
      },
    },
  },
  plugins: [],
}
