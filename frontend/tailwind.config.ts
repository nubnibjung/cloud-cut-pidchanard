import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: '#2f3542',
        panel: '#171a20',
        surface: '#20242d',
        accent: '#2dd4bf'
      }
    }
  },
  plugins: []
} satisfies Config;
