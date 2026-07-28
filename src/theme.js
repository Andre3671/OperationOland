// PrimeVue theme preset for Operation Roadtrip.
//
// PrimeVue 4 is token-driven, so the design system lives here rather than in a
// pile of component overrides. The same values are mirrored as plain CSS
// variables in styles.css for the hand-built UI (compass, maps, role cards,
// overlays) that isn't made of PrimeVue components.
//
// Keep the two in sync: if you change a surface or radius here, change it there.
//
// Package note: PrimeVue moved its theme package from @primevue/themes to
// @primeuix/themes in 4.3. This targets PrimeVue >= 4.5 / @primeuix/themes 2.x.
import { definePreset } from '@primeuix/themes'
import Aura from '@primeuix/themes/aura'

export default definePreset(Aura, {
  semantic: {
    // Indigo-leaning blue that reads as "mission control" without the old
    // #00ff00 terminal glare.
    primary: {
      50:  '#eef3ff',
      100: '#dbe5ff',
      200: '#bccfff',
      300: '#93b0ff',
      400: '#6d94ff',
      500: '#4f7cff',
      600: '#4269e6',
      700: '#3455bd',
      800: '#2b4596',
      900: '#25397a',
      950: '#16224d',
    },

    // Rounder than Aura's defaults — this is the single biggest visual shift
    // from the old angular terminal look.
    borderRadius: {
      none: '0',
      xs:   '6px',
      sm:   '10px',
      md:   '14px',
      lg:   '20px',
      xl:   '26px',
    },

    focusRing: {
      width: '3px',
      style: 'solid',
      color: '{primary.200}',
      offset: '2px',
    },

    colorScheme: {
      light: {
        surface: {
          0:   '#ffffff',
          50:  '#f6f8fd',
          100: '#eef2fa',
          200: '#e4e9f4',
          300: '#cdd6e8',
          400: '#93a0bb',
          500: '#5a6785',
          600: '#3d4863',
          700: '#2a334a',
          800: '#1c2438',
          900: '#16203a',
          950: '#0d1220',
        },
        formField: {
          background: '{surface.50}',
          borderColor: '{surface.200}',
          hoverBorderColor: '{surface.300}',
          focusBorderColor: '{primary.500}',
        },
      },
      dark: {
        surface: {
          0:   '#161d33',
          50:  '#111829',
          100: '#1c2440',
          200: '#26304d',
          300: '#333f63',
          400: '#66739a',
          500: '#9aa6c6',
          600: '#b8c2dc',
          700: '#d2d9ec',
          800: '#e5eaf7',
          900: '#f2f5ff',
          950: '#ffffff',
        },
        formField: {
          background: '{surface.50}',
          borderColor: '{surface.200}',
          hoverBorderColor: '{surface.300}',
          focusBorderColor: '{primary.400}',
        },
      },
    },
  },
})
