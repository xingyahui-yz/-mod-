import type { SVGProps } from 'react'

/**
 * Selected geometry paths adapted from GlacierGlimmer/zmd-charge-plus'
 * Customization/IconCatalog.cs. See THIRD-PARTY-NOTICES.md for the MIT notice.
 */
const iconPaths = {
  activity: 'M2,13 L6,13 L9,6 L13,19 L16,11 L22,11 L22,14 L18,14 L13,23 L9,11 L8,16 L2,16 Z',
  api: 'M7,4 L17,4 L17,8 L20,8 L20,16 L17,16 L17,20 L7,20 L7,16 L4,16 L4,8 L7,8 Z M9,9 L15,9 L15,15 L9,15 Z',
  bolt: 'M10,1 L4,11 L9,11 L7,19 L16,8 L11,8 Z',
  code: 'M8,5 L2,12 L8,19 L10,17 L6,12 L10,7 Z M16,5 L14,7 L18,12 L14,17 L16,19 L22,12 Z M13,4 L15,4 L11,20 L9,20 Z',
  cpu: 'M5,5 L19,5 L19,19 L5,19 Z M9,9 L15,9 L15,15 L9,15 Z M8,1 L8,4 M12,1 L12,4 M16,1 L16,4 M8,20 L8,23 M12,20 L12,23 M16,20 L16,23 M1,8 L4,8 M1,12 L4,12 M1,16 L4,16 M20,8 L23,8 M20,12 L23,12 M20,16 L23,16',
  database: 'M4,5 A8,3 0 1 1 20,5 A8,3 0 1 1 4,5 Z M4,5 L4,12 C4,14 7.6,15.5 12,15.5 C16.4,15.5 20,14 20,12 L20,5 C18.4,7 15.2,8 12,8 C8.8,8 5.6,7 4,5 Z M4,12 L4,19 C4,21 7.6,22.5 12,22.5 C16.4,22.5 20,21 20,19 L20,12 C18.4,14 15.2,15 12,15 C8.8,15 5.6,14 4,12 Z',
  disk: 'M4,3 L20,3 L20,21 L4,21 Z M7,6 L17,6 L17,14 L7,14 Z M7,17 L9,17 M12,17 L17,17',
  download: 'M10,3 L14,3 L14,12 L18,12 L12,18 L6,12 L10,12 Z M4,20 L20,20 L20,22 L4,22 Z',
  laptop: 'M4,5 L20,5 L20,16 L4,16 Z M2,18 L22,18 L20,21 L4,21 Z',
  monitor: 'M3,4 L21,4 L21,17 L3,17 Z M9,19 L15,19 L15,21 L9,21 Z',
  network: 'M12,3 C7,3 3,6 1,9 L4,12 C6,10 9,8 12,8 C15,8 18,10 20,12 L23,9 C21,6 17,3 12,3 Z M12,10 C9,10 7,11 5,14 L8,17 C9,16 10,15 12,15 C14,15 15,16 16,17 L19,14 C17,11 15,10 12,10 Z M12,18 C10.9,18 10,18.9 10,20 C10,21.1 10.9,22 12,22 C13.1,22 14,21.1 14,20 C14,18.9 13.1,18 12,18 Z',
  power: 'M11,2 L13,2 L13,12 L11,12 Z M7,5 C3.8,6.8 2,10 2,13.5 C2,19 6.5,23 12,23 C17.5,23 22,19 22,13.5 C22,10 20.2,6.8 17,5 L15.5,7.6 C17.7,8.8 19,11 19,13.5 C19,17.4 15.9,20 12,20 C8.1,20 5,17.4 5,13.5 C5,11 6.3,8.8 8.5,7.6 Z',
  refresh: 'M12,3 C16.4,3 20,6 20.8,10 L17.5,10 L22,15 L26,10 L23.8,10 C22.9,4.3 18,0 12,0 C7,0 2.7,3 1,7 L4,8.2 C5.3,5.1 8.4,3 12,3 Z M12,21 C7.6,21 4,18 3.2,14 L6.5,14 L2,9 L-2,14 L0.2,14 C1.1,19.7 6,24 12,24 C17,24 21.3,21 23,17 L20,15.8 C18.7,18.9 15.6,21 12,21 Z',
  server: 'M3,3 L21,3 L21,9 L3,9 Z M3,10 L21,10 L21,16 L3,16 Z M3,17 L21,17 L21,23 L3,23 Z M6,6 A1,1 0 1 1 5.99,6 M6,13 A1,1 0 1 1 5.99,13 M6,20 A1,1 0 1 1 5.99,20',
  settings: 'M10,2 L14,2 L15,5 C16,5.4 17,6 17.8,6.7 L21,6 L23,10 L20.5,12 C20.6,12.7 20.6,13.3 20.5,14 L23,16 L21,20 L17.8,19.3 C17,20 16,20.6 15,21 L14,24 L10,24 L9,21 C8,20.6 7,20 6.2,19.3 L3,20 L1,16 L3.5,14 C3.4,13.3 3.4,12.7 3.5,12 L1,10 L3,6 L6.2,6.7 C7,6 8,5.4 9,5 Z M12,9 A4,4 0 1 1 11.99,9 Z',
  shield: 'M12,2 L21,6 L20,13 C19.5,17.5 16.7,20.7 12,23 C7.3,20.7 4.5,17.5 4,13 L3,6 Z M11,7 L13,7 L13,12 L17,12 L17,14 L11,14 Z',
  upload: 'M12,3 L18,9 L14,9 L14,18 L10,18 L10,9 L6,9 Z M4,20 L20,20 L20,22 L4,22 Z',
} as const

export type IconName = keyof typeof iconPaths

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  size?: number
  title?: string
}

export function Icon({ name, size = 18, title, ...props }: IconProps) {
  const labelProps = title ? { role: 'img' as const, 'aria-label': title } : { 'aria-hidden': true as const }
  const viewBox = name === 'refresh' ? '-2 0 28 24' : '0 0 24 24'

  return (
    <svg
      className="ui-icon"
      width={size}
      height={size}
      viewBox={viewBox}
      fill="currentColor"
      fillRule="evenodd"
      focusable="false"
      {...labelProps}
      {...props}
    >
      <path d={iconPaths[name]} />
    </svg>
  )
}
