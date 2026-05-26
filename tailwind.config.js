const { colors, radii } = require('./theme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors,
      borderRadius: Object.fromEntries(
        Object.entries(radii).map(([k, v]) => [k, `${v}px`])
      ),
    },
  },
  plugins: [],
};
