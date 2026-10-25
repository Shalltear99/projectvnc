import type { Config } from 'tailwindcss';

/**
 * Design tokens are taken verbatim from docs/design.md section 2:
 *   accent indigo #6366F1 / #4F46E5, background slate-900 #0F172A,
 *   card slate-800 #1E293B, success emerald-500 #10B981, error rose-500 #F43F5E.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./src/pages/**/*.{ts,tsx}', './src/components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: '#6366F1',
          strong: '#4F46E5',
        },
        surface: {
          base: '#0F172A', // slate-900
          card: '#1E293B', // slate-800
          raised: '#243247',
          line: '#334155',
        },
        status: {
          ok: '#10B981',
          bad: '#F43F5E',
          warn: '#F59E0B',
        },
        /*
         * Cyber/gaming palette for the session workspace. Deliberately a
         * separate namespace from `surface` so the marketing pages keep the
         * indigo identity while the VNC workspace goes dark-emerald.
         */
        cyber: {
          bg: '#0B0F17',
          panel: '#111827',
          raised: '#0F1520',
          line: '#1F2937',
          edge: '#0D1220',
        },
        neon: {
          DEFAULT: '#10B981',
          deep: '#059669',
          dim: '#064E3B',
        },
        electric: {
          DEFAULT: '#3B82F6',
          deep: '#2563EB',
          dim: '#1E3A8A',
        },
      },
      fontFamily: {
        // Local stacks only — a Google Fonts fetch would break offline builds.
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'Liberation Mono',
          'monospace',
        ],
      },
      boxShadow: {
        panel: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 18px 40px -24px rgba(0,0,0,0.9)',
        glow: '0 0 0 1px rgba(99,102,241,0.35), 0 8px 30px -12px rgba(99,102,241,0.55)',
        // Active-session glow used by the VNC canvas wrapper.
        'glow-emerald': '0 0 0 1px rgba(16,185,129,0.30), 0 0 40px -12px rgba(16,185,129,0.35)',
        'glow-blue': '0 0 0 1px rgba(59,130,246,0.35), 0 8px 30px -12px rgba(59,130,246,0.55)',
        'inner-line': '0 1px 0 0 rgba(255,255,255,0.04) inset',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
        // Expanding halo behind the online dot (belivnc-style status pulse).
        pulseDot: {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '70%': { transform: 'scale(2.4)', opacity: '0' },
          '100%': { transform: 'scale(2.4)', opacity: '0' },
        },
        sheetUp: {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 180ms ease-out both',
        'pulse-soft': 'pulseSoft 1.8s ease-in-out infinite',
        'pulse-dot': 'pulseDot 2s cubic-bezier(0.4,0,0.6,1) infinite',
        'sheet-up': 'sheetUp 220ms cubic-bezier(0.22,1,0.36,1) both',
      },
    },
  },
  plugins: [],
};

export default config;
