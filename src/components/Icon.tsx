import type { SVGProps } from 'react'

// Mod Studio's own stroke icon set; no font or network dependency.
const iconPaths = {
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  cardAttack: 'M14 3 20 2l-1 6-9 9-4 1 1-4 7-7Zm-8 11 4 4m-6 3 5-5',
  cardSkill: 'M12 3 20 6v5c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6l8-3Zm-4 9 3 3 5-6',
  cardPower: 'M12 3l2.2 5.4 5.8-1.1-3.1 5 3.1 5-5.8-1.1L12 21l-2.2-4.8L4 17.3l3.1-5L4 7.3l5.8 1.1L12 3Z',
  api: 'M9 8 5 12l4 4m6-8 4 4-4 4M13 5l-2 14',
  bolt: 'm13 3-8 10h6l-1 8 9-11h-6l1-7Z',
  code: 'm8 7-5 5 5 5m8-10 5 5-5 5M14 4l-4 16',
  cpu: 'M6 6h12v12H6ZM9 9h6v6H9ZM9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3',
  database: 'M20 6c0 2-3.6 3-8 3S4 8 4 6s3.6-3 8-3 8 1 8 3ZM4 6v12c0 2 3.6 3 8 3s8-1 8-3V6M4 12c0 2 3.6 3 8 3s8-1 8-3',
  disk: 'M5 3h12l4 4v14H3V3h2Zm2 0v6h9V3M7 21v-8h10v8',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  laptop: 'M4 4h16v13H4ZM2 20h20',
  monitor: 'M3 3h18v14H3ZM12 17v4m-5 0h10',
  network: 'M3 8a14 14 0 0 1 18 0M6 12a9 9 0 0 1 12 0m-9 4a4 4 0 0 1 6 0M12 20h.01',
  power: 'M12 2v10M6 5a9 9 0 1 0 12 0',
  refresh: 'M20 8a8 8 0 0 0-14-2L3 9m0-5v5h5M4 16a8 8 0 0 0 14 2l3-3m0 5v-5h-5',
  server: 'M3 3h18v7H3ZM3 14h18v7H3ZM7 6.5h.01M7 17.5h.01',
  settings: 'M9 3h6l1 3 3 1 2 5-2 2-1 3-3 1-1 3H9l-1-3-3-1-2-5 2-2 1-3 3-1 1-3ZM16 12a4 4 0 1 0-8 0 4 4 0 0 0 8 0Z',
  shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5',
  cards: 'M7 3h13v17H7ZM3 7v14h13M11 8h5m-5 4h5',
  gem: 'm3 8 4-5h10l4 5-9 13-9-13ZM3 8h18M7 3l5 18 5-18',
  folder: 'M3 5h7l2 3h9v12H3V5Z',
  file: 'M5 3h9l5 5v13H5V3Zm9 0v6h5M9 13h6m-6 4h6',
  search: 'M17 10a7 7 0 1 0-14 0 7 7 0 0 0 14 0Zm-2 5 6 6',
  plus: 'M12 5v14M5 12h14',
  close: 'm6 6 12 12M6 18 18 6',
  arrowRight: 'M4 12h16m-6-6 6 6-6 6',
  arrowLeft: 'M20 12H4m6-6-6 6 6 6',
  chevronRight: 'm9 5 7 7-7 7',
  check: 'm5 12 4 4L19 6',
  circle: 'M21 12a9 9 0 1 0-18 0 9 9 0 0 0 18 0Z',
  skip: 'm5 5 10 7-10 7V5Zm14 0v14',
  sun: 'M16 12a4 4 0 1 0-8 0 4 4 0 0 0 8 0ZM12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5',
  moon: 'M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10Z',
  info: 'M21 12a9 9 0 1 0-18 0 9 9 0 0 0 18 0ZM12 11v6m0-10h.01',
  message: 'M3 4h18v13H9l-6 4V4ZM7 9h10m-10 4h6',
  undo: 'M9 4 3 10l6 6M3 10h11a6 6 0 0 1 0 12',
  redo: 'm15 4 6 6-6 6m6-6H10a6 6 0 0 0 0 12',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
} as const

export type IconName = keyof typeof iconPaths
interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  size?: number
  title?: string
}

export function Icon({ name, size = 18, title, className, ...props }: IconProps) {
  const labelProps = title ? { role: 'img' as const, 'aria-label': title } : { 'aria-hidden': true as const }
  return (
    <svg className={['ui-icon', className].filter(Boolean).join(' ')} width={size} height={size}
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
      strokeLinecap="round" strokeLinejoin="round" focusable="false" {...labelProps} {...props}>
      <path d={iconPaths[name]} />
    </svg>
  )
}
