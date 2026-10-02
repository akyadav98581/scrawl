export const INK = '#111111'
export const COLORS = ['#111111', '#787774', '#B8403D', '#B07A12', '#3F7A45', '#2E6FA3']
export const WIDTHS = [2, 4, 8]

// Cursor colours for other people. Ink is left out so a cursor never looks like a pen.
export const USER_COLORS = ['#B8403D', '#B07A12', '#3F7A45', '#2E6FA3', '#7A4FA0', '#1B7F7A']

const adj = ['Quiet', 'Brisk', 'Amber', 'Tidy', 'Lucky', 'Mossy', 'Sandy', 'Plain', 'Wired', 'Dusty']
const animal = ['Heron', 'Otter', 'Finch', 'Badger', 'Lynx', 'Wren', 'Marmot', 'Gecko', 'Ibis', 'Newt']
const pick = (a) => a[Math.floor(Math.random() * a.length)]

export const randomName = () => `${pick(adj)} ${pick(animal)}`
export const randomUserColor = () => pick(USER_COLORS)
