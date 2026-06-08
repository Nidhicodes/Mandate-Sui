import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        sui: { DEFAULT: '#4DA2FF', dark: '#1A1F2E' },
        walrus: { DEFAULT: '#6366f1', light: '#818cf8' },
        mandate: { DEFAULT: '#10b981', light: '#34d399' },
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'typing': 'typing 0.5s steps(20) forwards',
      },
    },
  },
  plugins: [],
};

export default config;
