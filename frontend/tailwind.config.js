/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#080d17',
          900: '#0f172a',
          850: '#131d31',
          800: '#1b2740',
        },
        accent: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        // Soft, low-contrast elevation: a hairline plus a wide diffuse halo. Heavy
        // drop shadows are the fastest way to make a dashboard feel dated and noisy.
        card: '0 1px 2px 0 rgb(15 23 42 / 0.03), 0 1px 3px 0 rgb(15 23 42 / 0.04)',
        soft: '0 1px 2px 0 rgb(15 23 42 / 0.03), 0 8px 24px -14px rgb(15 23 42 / 0.14)',
        lift: '0 2px 4px -1px rgb(15 23 42 / 0.04), 0 16px 40px -20px rgb(15 23 42 / 0.20)',
        panel: '0 10px 30px -12px rgb(15 23 42 / 0.25)',
      },
      keyframes: {
        'fade-up': { '0%': { opacity: 0, transform: 'translateY(6px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
        'pulse-ring': { '0%': { boxShadow: '0 0 0 0 rgb(37 99 235 / 0.45)' }, '100%': { boxShadow: '0 0 0 10px rgb(37 99 235 / 0)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'fade-in': { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
      },
      animation: {
        'fade-up': 'fade-up 0.28s ease-out both',
        'pulse-ring': 'pulse-ring 1.8s cubic-bezier(0.4,0,0.6,1) infinite',
        shimmer: 'shimmer 1.6s infinite',
        'fade-in': 'fade-in 0.2s ease-out both',
      },
    },
  },
  plugins: [],
};
