// ANSI terminal color helpers (replaces chalk)

const ESC = '\x1b[';
const RESET = `${ESC}0m`;

const wrap = (code: string, text: string): string => `${ESC}${code}m${text}${RESET}`;

export const bold = (text: string) => wrap('1', text);
export const dim = (text: string) => wrap('2', text);
export const italic = (text: string) => wrap('3', text);
export const underline = (text: string) => wrap('4', text);
export const strikethrough = (text: string) => wrap('9', text);

export const black = (text: string) => wrap('30', text);
export const red = (text: string) => wrap('31', text);
export const green = (text: string) => wrap('32', text);
export const yellow = (text: string) => wrap('33', text);
export const blue = (text: string) => wrap('34', text);
export const magenta = (text: string) => wrap('35', text);
export const cyan = (text: string) => wrap('36', text);
export const white = (text: string) => wrap('37', text);
export const gray = (text: string) => wrap('90', text);

export const bgRed = (text: string) => wrap('41', text);
export const bgGreen = (text: string) => wrap('42', text);
export const bgYellow = (text: string) => wrap('43', text);
export const bgBlue = (text: string) => wrap('44', text);
export const bgMagenta = (text: string) => wrap('45', text);
export const bgCyan = (text: string) => wrap('46', text);
