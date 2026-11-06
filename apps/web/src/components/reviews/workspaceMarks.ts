export function markTimestamp(value: string, utc: boolean, hour24: boolean): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const part = (local: number, universal: number) => (utc ? universal : local);
  const pad = (number: number) => String(number).padStart(2, "0");
  const hour = part(date.getHours(), date.getUTCHours());
  return `${part(date.getFullYear(), date.getUTCFullYear())}-${pad(part(date.getMonth(), date.getUTCMonth()) + 1)}-${pad(part(date.getDate(), date.getUTCDate()))} ${pad(hour24 ? hour : hour % 12 || 12)}:${pad(part(date.getMinutes(), date.getUTCMinutes()))}${hour24 ? "" : hour < 12 ? " AM" : " PM"}`;
}
