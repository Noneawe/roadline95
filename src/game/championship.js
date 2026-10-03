// Championship: points per round from the finishing order, standings with ties broken by countback
// (more wins, then more second places, ...) and then by the better result in the latest round.
// Pure logic, no DOM; the season data lives in data/championship.js.

export class Championship {
  /**
   * @param {{ rounds: object[], points: number[] }} season
   * @param {{ id: number, name: string, isPlayer: boolean }[]} entrants same ids in every round
   */
  constructor(season, entrants) {
    this.season = season;
    this.round = 0;
    this.table = entrants.map((e) => ({ ...e, points: 0, places: [], last: Infinity }));
  }

  /** @returns {boolean} every round has been scored */
  get finished() {
    return this.round >= this.season.rounds.length;
  }

  /** @returns {object | null} the round to race next */
  get current() {
    return this.finished ? null : this.season.rounds[this.round];
  }

  /**
   * Scores a round. `order` lists entrant ids from first to last (non-finishers at the end).
   * @param {number[]} order
   */
  addResult(order) {
    if (this.finished) throw new Error('season already finished');
    order.forEach((id, k) => {
      const row = this.table.find((r) => r.id === id);
      if (!row) throw new Error(`unknown entrant ${id}`);
      row.points += this.season.points[k] || 0;
      row.places.push(k + 1);
      row.last = k + 1;
    });
    this.round++;
  }

  /**
   * Standings, best first.
   * @returns {{ id: number, name: string, isPlayer: boolean, points: number, places: number[], last: number }[]}
   */
  standings() {
    const count = (r, place) => r.places.filter((p) => p === place).length;
    return [...this.table].sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      for (let place = 1; place <= this.table.length; place++) {
        const d = count(b, place) - count(a, place);
        if (d) return d;
      }
      return a.last - b.last;
    });
  }

  /** @returns {object | null} the champion once the season is finished */
  champion() {
    return this.finished ? this.standings()[0] : null;
  }
}
