# Muster

Turn-based unit battler for iPhone. Each commander has 400 health. Every round both sides buy units from a shop of four and place them anywhere in their half; units stay on the board and come back each round, so armies build up. Then the battle plays out on its own: free 360° steering, no grid, every unit with its own behaviour. The loser of a round takes damage: a base that grows each round, plus twice the threat of the winner's survivors.

## Units (12)

| Unit | Cost | Behaviour |
| --- | --- | --- |
| Mine | 2 | Buried and untargetable; a short fuse when an enemy steps close, then a blast 1 unit wide |
| Blade Trio | 3 | Three swords, one shared target, surround it and slash in an arc |
| Ranger | 3 | Holds bow range, strafes, backs off when rushed |
| Bulwark | 4 | Shield takes 60% less from the front; guards the ally in most danger; draws melee to itself |
| Medic | 3 | Heals the most hurt ally while keeping it between itself and the enemy |
| Grenadier | 4 | Lobs bombs where enemies will be bunched when they land |
| Shade | 4 | Cloaked flank, blinks behind the softest target and backstabs |
| Lancer | 4 | Aims, charges straight through a line, wheels round in an arc, again |
| Ballista | 3 | Fixed; slow turret; bolts pierce everything in line |
| Hive | 4 | Fixed; breeds mites that swarm (and trip mines) |
| Stormcaller | 5 | Chain lightning that jumps between bunched enemies |
| Golem | 5 | Slow giant, walks at structures first, splits into two golemlings when it falls |

Upgrade a placed unit to rank 2 and 3; sell for half of what it cost. Unspent gold earns interest (1 per 5, max 3).

## The AI

`src/core/ai.ts`. An `AIProfile` sets **difficulty** (how many plans it tests in simulation, how sharply it counters, how often it blunders), **aggression** (formation depth, damage vs defence), **tactic** (balanced, swarm, fortress, artillery, ambush, blitz, siege), **economy** (bank for interest and upgrades vs spend), **rerolls** and **spread** (formation width). Hard AIs simulate each candidate draft and formation against your visible board plus a guess at what you'll add; buried mines stay hidden from it. Tune them in-game under Skirmish (AI lab), including AI-vs-AI.

## Modes

- **Campaign**: acts of six levels with a boss at the end of each, a new unit unlocked along the way, three stars per level. The current level, act and puzzle counts come from `src/core/counts.ts` (`npm run release:config` prints them).
- **Gauntlet**: one health pool against rival after rival; your army carries over and each win brings a boon.
- **Breakpoint**: one-battle puzzles against a fixed visible board with fixed gold; win, then win cheaper for stars.
- **Skirmish**: any AI profile, any health, or watch two AIs.

## Run

```
npm install
npm run dev          # http://localhost:5180 (deep links: ?level=3 ?puzzle=2 ?lab ?watch ?gauntlet)
npm test             # sim, match, AI, content
npm run build
npm run ios:sim      # build the iOS app for the simulator (Capacitor, no signing)
npm run ios:run      # build, install and launch on the booted simulator
npm run ios:open     # open in Xcode to run on a device
node tools/shot.mjs "/?level=1" out.png   # phone-size screenshot of the dev server
node tools/e2e.mjs <dir>                  # full AI-vs-AI match in the browser
```

Code: `src/core` is pure and deterministic (battle sim, match, AI, content); `src/render` draws it on a canvas; `src/ui` is the HUD and screens.

## Play online (Versus)

```
npm run play                    # match server + game on this machine, browser opens on Versus
npm run play -- --two           # ...with a second player in another tab
npm run play -- --add K7QF2M    # ...and ask that player to be friends on arrival
npm run play -- --tunnel        # host for friends anywhere: one public link, nothing for them to install (needs cloudflared)
npm run play -- --server <url>  # use a match server that is already running
npm run server                  # the match server alone (port 8787; serves dist/ too if it is built)
npm run token -- "Sam"          # issue Sam a token (also --friend CODE, --list, --revoke CODE; needs MUSTER_ADMIN_KEY)
npm run e2e:versus              # two browsers play a match against the running game (after `npm run play -- --no-open`)
```

With Claude Code, one line sets a new player up: `git clone <repo> muster && cd muster && claude "/play <their token>"` (`.claude/commands/play.md`). `npm run token` prints that line ready to send.

Versus is in the Modes tab: your name and friend code, **Find match** (ranked), your friends with a **Challenge** button (friendly, unranked, everyone at level 1), your ranked army and the ladder. An invite is a link (`?add=CODE`) or the six-character code.

### The ladder

Ranked play is a trophy ladder (`src/net/ladder.ts`). A win is worth about 30 trophies (more against someone above you); a loss costs the same, less in the first two leagues. Eight leagues open at 0, 300, 600, 1000, 1400, 1800, 2200 and 2600 trophies, and a league once reached is kept: you never fall below its floor.

Scripted players are on the ladder, in the lower ranks only. That means the server's own house bots (16 by default, spread from 0 to 599 trophies, playing with the game's AI), tokens issued with `--bot`, and any account the automation checks have flagged three times. None of them can hold more than 599 trophies, so from the third league up every rival is a person. A player below that line who waits six seconds for a person is given a house bot, so there is always a match; above it the queue waits for people.

### The economy is the server's

Coins, gems, cards and troop levels for ranked play live in the server's database (`server/account.ts`), not on the device. A client can ask for an upgrade or a gem purchase; the server checks it against the game's own cost tables and answers with the new account. There is no call that sets a balance. Ranked matches are fought at each player's server-held levels, and pay coins and cards the server rolls (full rewards for the first ten wins of a day). Money comes in one way: your payment handler calls `POST /v1/store/webhook` with `{txId, player, sku}`, signed (`x-muster-signature`: HMAC-SHA256 of the body with `MUSTER_PAYMENT_SECRET`); each `txId` pays out once. Looks and names are the player's to change; the ledger is not.

The solo modes (campaign, Gauntlet, Daily, the Shop and Pass tabs) still keep their own progress on the device. They do not touch the server account and nothing in them counts in ranked.

How it works: the server (`server/`) owns the only real match. A client sends what the player wants (buy, upgrade, sell, reroll, where the pieces stand at Ready); the server checks it against the rules, deals every shop and fights every battle from its own randomness, then sends both players the same pieces and seed to replay. The outcome is the server's. Seat 1 watches the same battle turned half a turn (`src/net/mirror.ts`), so both players stand at the bottom in blue. A player never receives the rival's shop, this round's purchases or anything that predicts a shop or a battle.

| Where | What |
| --- | --- |
| `server/room.ts` | one match: rules, clocks (60 s first deploy, 45 s after, both counted by the server), forfeits |
| `server/hub.ts` | connections, friends, challenges, the ranked queue |
| `server/app.ts` | HTTP endpoints under `/v1`, the push socket `/v1/ws`, rate limits, static files |
| `server/store.ts` | SQLite (`server/data/muster.db`): players, friendships, finished matches, accounts, purchases |
| `server/telemetry.ts` | automation checks on action timing; flagged matches count on the player |
| `server/account.ts` | the economy: accounts, upgrades, products, match rewards |
| `src/net/ladder.ts` | trophies, leagues, the cap on scripted players |
| `src/net/` | the client: account and socket, the online match, the board turn |
| `src/ui/versus.ts` | the Versus screen |

Hosting: `server.config.json` holds the hosted server's address; once set, every clone and every build uses it (`VITE_MUSTER_SERVER` and `?server=` override). The `Dockerfile` runs the server with the built game on one port; keep `server/data` on a volume. Settings: `PORT`, `MUSTER_DB`, `MUSTER_ADMIN_KEY` (turns on the `/v1/admin` routes, header `x-admin-key`), `MUSTER_INVITE_ONLY=1` (no self sign-up: every player holds a token you issued), `MUSTER_HOUSE_BOTS` (how many house bots, default 16), `MUSTER_PAYMENT_SECRET` (turns on the payment webhook), `TRUST_PROXY=1` behind a proxy.

Branches and CI: `main` is where work lands; `production` is what is deployed. Every push and pull request runs the checks (`.github/workflows/ci.yml`: types, tests, build, then two browsers playing a match). A push to `production` also builds the server image, publishes it to the GitHub container registry and, once the repository variable `DEPLOY_HOST` is set, restarts it on that machine (`.github/workflows/deploy.yml` lists the settings it needs). Promote with a pull request from `main` to `production`.

### Tokens

A player is a token. On an open server (the default, and what `npm run play` starts locally) the game makes one on first use. On an invite-only server you issue them: `npm run token -- "Sam" --friend <your code>` prints the token once (the server keeps only its hash) and the line to send Sam. `--revoke` switches one off: the holder drops out of the queue and any match, and their sockets close. A token is a person, so whatever is built on one is that person's to answer for.

### The API

Anything the game does, a token holder can do: the game has no private endpoints. Send `Authorization: Bearer <token>` and JSON.

| Call | Body | Does |
| --- | --- | --- |
| `POST /v1/register` | `name` | a new player and token (open servers only) |
| `GET /v1/me`, `POST /v1/me` | `name` | your card (name, friend code, rating); rename |
| `GET /v1/friends` | | friends, requests in and out, challenges waiting |
| `POST /v1/friends/add` | `code` | ask a player to be friends (asking back accepts) |
| `POST /v1/friends/respond`, `/remove` | `id`, `accept` | answer a request; drop a friend |
| `POST /v1/queue/join`, `/leave` | | ranked matchmaking |
| `POST /v1/challenge`, `/respond`, `/cancel` | `friendId` or `id`, `accept` | friendly matches |
| `GET /v1/match` | | your view of the match you are in |
| `POST /v1/match/act` | `action` | `{t:"buy",slot,x,y}`, `{t:"upgrade",id}`, `{t:"sell",id}`, `{t:"reroll"}`; answers with your view |
| `POST /v1/match/ready` | `placements` | done deploying: `[{id,x,y}]` |
| `POST /v1/match/watched`, `/forfeit` | `round` | battle seen (starts the deploy clock once both have); give up |
| `GET /v1/history`, `GET /v1/leaderboard` | | your matches; the ladder |
| `GET /v1/account`, `POST /v1/account/upgrade` | `kind` | your coins, gems, cards and levels; buy a unit's next level |
| `GET /v1/store`, `POST /v1/store/buy` | `sku` | what is for sale; buy a gem-priced product |

The socket `/v1/ws` only pushes: send `{"t":"auth","token":"..."}` first, then listen. Every message and view is typed in `src/net/protocol.ts`, and coordinates are in the server's frame (seat 0 deploys at the bottom, y near 14; seat 1 at the top). `tests/server.test.ts` has a complete scripted player in about twenty lines.

Known limit: the replay runs the same simulation on the device as on the server. On the same JavaScript engine it is identical; on another one a battle could drift, in which case the score still follows the server.

## Release (App Store)

`app.config.json` is the one place for the store name, home-screen name, version, build, bundle id and team; `npm run release:config` spreads it to Xcode (`ios/app.xcconfig`, `ios/App/ExportOptions.plist`), the listing (`store/`) and the site (`site/`), and checks App Store limits.

```
npm run ios:release:dry   # Release build for the simulator, unsigned: proves the Release config compiles
npm run store:shots       # 6.9" App Store screenshots into store/screenshots (uses or starts the dev server)
npm run ios:release       # Jack only: signed Release archive (talks to Apple for signing)
npm run ios:export        # Jack only: App Store .ipa from that archive
```

Step by step: `store/RELEASE-CHECKLIST.md`. Listing copy: `store/LISTING.md`. Privacy and support pages: `site/` (static).
