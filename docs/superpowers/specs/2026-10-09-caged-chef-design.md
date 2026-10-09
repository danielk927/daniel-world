# Chef Skinner, locked in the walk-in

Approved by Daniel on 2026-10-09.

Chef Skinner no longer walks the lobby from the start.
He is locked in the walk-in cooler of every room, and breaking its door lets him loose.
The walk-in stays the secret it is, and now it hides someone.

## What visitors see

- Every room, the public lobby and private parties alike, starts with the walk-in shut and no Chef Skinner anywhere.
  He is not in the player list, not on the minimap, has no name tag and says nothing.
  Nothing in the game or on the wire gives him away.
- The tenth hit bursts the door, as it does today.
  About a second later, once the burst has shown on every screen, he appears at the back of the cold room, shouts one line and walks out through the doorway.
- Everyone in the room gets his usual 8 s newcomer grace from the moment he appears, which plays as a head start.
- From then on he is the Chef Skinner of today: he roams the aisles, pauses at stations and throws.
  He can wander back into the cold room.
  Knocked out, he gets back up at a spawn point in the kitchen.
- He stays loose until the room empties.
  The door is whole again and he is gone with the last visitor, as both already are, so the next visitors find him locked in again.
- Unchanged: the "Chef Skinner throws knives at me" setting, his targeting rules, his lines on knockouts, and the landing page counting visitors only.

## How it works

All of it is in the room server.
Clients see him join like any other player, with the resident flag as today, so the protocol does not change.

### When he is created

- He is created when the door bursts, not with the room.
  The room calls a burst hook from where it decides the tenth hit (`hitCooler`, in the same style as `onKnockout`).
- The server holds his entrance for 60 ticks (1 s) after the burst.
  The burst shows on each screen when the fist or knife that made it arrives there, a little after the server decides it; the delay keeps him out of the player list until the door has visibly burst everywhere.
- If the room empties during that second, he is never created.
- Every room gets him, not only the lobby.
  `CHEF=off` still turns him off everywhere.
- He joins with the door open for all his inputs (`coolerFrom` 0), as any later arrival does; by then the door has swung clear of the doorway.

### Where he goes

- He starts at the back of the cold room, clear of the shelves, facing the doorway.
- His entrance line is said as he appears, from a short list of its own (for example "Who locked me in the walk-in?!").
  It is his first line, so his 25 s quiet rule does not hold it back.
- His aisle graph gains two points: one in the middle of the cold room and one just inside the kitchen at the doorway, joined to the east end column.
  He only exists once the door is open, so those edges are always walkable for him.
  Every new edge clears the shelves, the door lying open against the cold room's south wall, and the doorway's frame by more than a player's radius.

### The room cap

- He counts toward the 16 players a room holds, as he does in the lobby today.
  So while he can appear (`CHEF` on), every room keeps a slot for him: 15 visitors, and 16 with `CHEF=off`.
  Parties lose one visitor slot; the lobby is unchanged.
- The room-count endpoint reports the visitor capacity instead of 16, which also fixes today's lobby reporting 16 when 15 visitors fit.
- `scripts/perf.ts` fills its party to that capacity rather than assuming 16, so it still works against a dev server with the chef on.

## Tests

- Server, in `chef.test.ts` and `server.test.ts`:
  - no chef before the burst, in the lobby or a party;
  - he is in the room, inside the cold room, 60 ticks after the tenth hit, and not before;
  - simulated forward, he is out through the doorway and in the kitchen within a few seconds;
  - nobody present is targeted during the 8 s after he appears;
  - a room emptied during the delay never creates him;
  - he is gone once the room empties, and absent again on the next visit;
  - with the chef on, the sixteenth visitor is turned away; with it off, the seventeenth is.
- Waypoints: the existing clearance test covers the new edges.
- E2E: `e2e/chef.spec.ts` checks he is absent from `window.__world` at first, breaks the door with ten punches as `e2e/cooler.spec.ts` does, then sees him appear and come out into the kitchen.
  The existing opt-out case keeps working once he is out.

## Docs

- `DECISIONS.md`: a dated section saying why (Daniel asked for it), that it reverses "a quiet portfolio should not feel empty", and the choices above.
- `CLAUDE.md`: the map line calling him "the lobby's resident knife-throwing cook".
- `PROGRESS.md`: a short entry.
