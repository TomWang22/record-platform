import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#5C6FF8',
          foreground: '#0B1220',
          subtle: '#E8EAFF',
        },
      },
      boxShadow: {
        card: '0 10px 40px -20px rgba(15, 23, 42, 0.25)',
      },
      borderRadius: {
        xl: '1rem',
      },
    },
  },
  plugins: [],
}

export default config












