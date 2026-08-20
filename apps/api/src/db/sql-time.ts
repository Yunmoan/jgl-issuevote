export function nowSql(): string {
  const value = toSqlDate(new Date());
  if (!value) throw new Error('无法生成当前时间');
  return value;
}

export function toSqlDate(input: Date | string | null | undefined) {
  if (!input) return null;
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
}
