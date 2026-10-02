/** Fuso horário sem dependências: converte hora local de um fuso IANA para UTC e vice-versa. */

function partsAt(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export function isLocalDateTime(value: string) {
  return LOCAL_RE.test(value);
}

/** "2026-10-03T19:00:00" no fuso dado > instante UTC. */
export function localToUtc(local: string, timeZone: string): Date {
  const m = local.match(LOCAL_RE);
  if (!m) throw new Error(`Data e hora inválidas: ${local}. Use AAAA-MM-DDTHH:MM.`);
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) throw new Error(`Data e hora inválidas: ${local}.`);
  const target = Date.UTC(y, mo - 1, d, h, mi, s);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = partsAt(new Date(guess), timeZone);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
    guess += target - asUtc;
  }
  return new Date(guess);
}

/** Instante > "2026-10-03T19:00:00" no fuso dado. */
export function utcToLocal(date: Date, timeZone: string): string {
  const p = partsAt(date, timeZone);
  const z = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${z(p.m)}-${z(p.d)}T${z(p.h)}:${z(p.mi)}:${z(p.s)}`;
}

/** "sexta-feira, 3 de outubro de 2026, 19:00" para mostrar à IA e às pessoas. */
export function describeLocal(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone, dateStyle: "full", timeStyle: "short" }).format(date);
}
