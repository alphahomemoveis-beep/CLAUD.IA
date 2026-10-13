import { describe, expect, it } from "vitest";
import { parseCuts, parseDuration, shotsFromCuts, MAX_SHOTS } from "@/lib/criar/shots";

describe("cortes do vídeo de inspiração", () => {
  it("lê a duração e os instantes de corte do ffmpeg", () => {
    const log = "  Duration: 00:00:07.00, start: 0.000000\n[Parsed_showinfo_2] n:0 pts:45 pts_time:1.5 duration\n[Parsed_showinfo_2] n:1 pts:105 pts_time:3.5 \n";
    expect(parseDuration(log)).toBe(7);
    expect(parseCuts(log)).toEqual([1.5, 3.5]);
  });
  it("transforma cortes em cenas com duração", () => {
    expect(shotsFromCuts([1.5, 3.5, 4.5], 7)).toEqual([
      { inicio: 0, fim: 1.5, duracao: 1.5 }, { inicio: 1.5, fim: 3.5, duracao: 2 },
      { inicio: 3.5, fim: 4.5, duracao: 1 }, { inicio: 4.5, fim: 7, duracao: 2.5 },
    ]);
  });
  it("junta piscadas de transição à cena anterior", () => {
    expect(shotsFromCuts([2, 2.2], 5)).toEqual([{ inicio: 0, fim: 2.2, duracao: 2.2 }, { inicio: 2.2, fim: 5, duracao: 2.8 }]);
  });
  it("vídeo sem cortes vira uma cena só", () => {
    expect(shotsFromCuts([], 9)).toEqual([{ inicio: 0, fim: 9, duracao: 9 }]);
  });
  it("nunca passa do máximo de cenas e cobre o vídeo inteiro", () => {
    const cuts = Array.from({ length: 30 }, (_, i) => (i + 1) * 1);
    const shots = shotsFromCuts(cuts, 31);
    expect(shots).toHaveLength(MAX_SHOTS);
    expect(shots[0].inicio).toBe(0);
    expect(shots.at(-1)!.fim).toBe(31);
  });
});
