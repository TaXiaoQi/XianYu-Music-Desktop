import md5Lib from 'blueimp-md5';

export function md5(input: string): string {
  return md5Lib(input);
}
