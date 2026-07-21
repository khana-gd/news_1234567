/**
 * Central brand theme for My Public Samachara
 * Extracted from the app logo (#1AAA94 teal)
 */

export const BRAND = {
  // Primary teal (from logo)
  primary: '#1AAA94',
  primaryDark: '#0D8975',
  primaryLight: '#B2E5DC',
  primarySoft: '#E6F7F3',

  // Accent (news accent — pink for badges, warmer gold for "verified")
  accent: '#E91E8C',
  accentSoft: '#FCE4EC',
  gold: '#F5B301',
  goldSoft: '#FFF4D6',

  // Neutrals
  bg: '#FAFAFA',
  card: '#FFFFFF',
  border: '#EAEAEA',

  // Text
  text: '#111111',
  textMuted: '#666666',
  textFaint: '#999999',

  // System
  danger: '#D32F2F',
  success: '#388E3C',
  warning: '#F57C00',

  // Semantic aliases (drop-in for old navy usages)
  navy: '#1AAA94',       // was #1565C0
  navyDark: '#0D8975',   // was #0D47A1
  navySoft: '#E6F7F3',   // was #E3F2FD
} as const;

export type BrandKey = keyof typeof BRAND;
