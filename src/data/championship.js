// Championship season data: rounds (track id, laps, weather), points per finishing place and the car unlocked
// by winning the title. Cars listed in `locked` cannot be chosen until unlocked (saved in storage.js).

export const SEASON = {
  name: 'ROADLINE CUP',
  rounds: [
    { track: 'raceway', laps: 3, weather: 'clear' },
    { track: 'harbour', laps: 3, weather: 'rain' },
    { track: 'desert', laps: 2, weather: 'clear' },
    { track: 'mountain', laps: 2, weather: 'fog' },
    { track: 'coast', laps: 1, weather: 'clear' },
  ],
  points: [10, 8, 6, 5, 4, 3, 2, 1],
  locked: ['auroraRS'],
  unlock: 'auroraRS',
};
