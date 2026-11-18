![gta6-01](https://make.fun/badge/gta6-01.svg)
![rank](https://make.fun/badge/gta6-01/liaokeaqr/gta6-01/rank.svg)
![reward](https://make.fun/badge/gta6-01/liaokeaqr/gta6-01/reward.svg)

# Costa Verde Hustle

A GTA 6-style open-world crime game that runs in a desktop browser from
static files — no network, no build step. You are a courier in the sun-soaked
harbor city of **Costa Verde**: take jobs, steal cars, dodge the harbor
police, and finish all five missions in the story chain.

## The city

Costa Verde is a 480 m grid city with roads, sidewalks, buildings, street
lamps and trees, built fresh from a seed every run. Traffic drives the roads,
pedestrians walk the sidewalks, and the harbor police answer your wanted
level with one cop per star, up to five stars.

## The story — five missions

1. **First Drop** — deliver a parcel to the north docks. ($150)
2. **Fare Game** — pick up a tourist at the plaza and drive them to the beach
   hotel. ($200)
3. **Street Justice** — a mugger is shaking down stalls near the market. Put
   him down. ($250)
4. **Heat Run** — the parcel was hot. Reach the safehouse with two stars on
   you, then lose the heat. ($300)
5. **The Last Package** — one last run to the lighthouse at the south point.
   ($500)

Finish all five and Costa Verde is yours. Get busted and the police fine you
$120 and dump you back at the spawn; lose all your health and the run is over.

## Playing

- **WASD / arrow keys** — drive and walk (W/S forward-back, A/D steer)
- **Shift** — boost / run
- **Space** — handbrake
- **E** — enter a car, steal a car, get out
- **F** — attack (pistol while it has ammo, fists otherwise)
- **P / Esc** — pause, **M** — mute, **Enter / click** — start
- Stealing a driven car, hitting a pedestrian or shooting a cop raises your
  wanted level. Lie low with no cop nearby and the heat cools off one star
  at a time.
- The HUD shows wanted stars, cash, score, health, ammo and speed, plus a
  minimap with the mission target, traffic, police and you. Progress and best
  score are saved in the browser; starting a new game from the title screen
  begins the story fresh.

## Running it locally

```bash
node serve.ts            # serves game/ at http://localhost:8080
```

Open `http://localhost:8080` in desktop Chrome and play. Everything the
game loads — the three.js build included — is a file under `game/`.

To produce the submission bundle locally:

```bash
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

That copies `game/` and `screenshots/` into `out/` and writes
`out/dossier.json`.

## Files

```text
main.ts                  # the submission program (Node 22, standard library only)
serve.ts                 # tiny static server for local play
shots.json               # the four screenshots (start / play / win / end)
game/index.html          # canvas + import map for three.js
game/src/config.js       # all tuning and colours in one place
game/src/random.js       # seeded RNG (mulberry32): same seed, same city
game/src/world.js        # pure game logic: city, traffic, police, missions, saves
game/src/render.js       # three.js scene, follow camera, HUD and minimap
game/src/input.js        # keyboard input (held vector + one-shot actions)
game/src/audio.js        # synthesised WebAudio sound, no audio files
game/src/shots.js        # screenshot scenes: real rules, fixed seed, autopilot
game/src/main.js         # boot, fixed-step loop, screens, save handling
game/vendor/three/three.module.min.js   # three.js 0.187.0, vendored
vendor/makefun-game.ts   # the kit's dossier builder, unchanged
```

## License

MIT. The city, characters, vehicles, names, story, art and sound are all
original — nothing from Rockstar Games or any other commercial game.
