# Proposal: the Ratatouille flashback

Status: for Daniel's approval.
Nothing here is built yet.

## The moment

In Ratatouille, the critic Anton Ego takes one bite and the restaurant falls away: he is a boy again, in his mother's kitchen, being comforted with a plate of ratatouille.
The site can have its own version, and it is the one place where a portfolio can say something no résumé can: what food, and making things, mean to Daniel.
The aim is one short, surprising, personal moment of about twenty seconds that people remember and tell others about.

## How it would play

1. **The invitation.** A plate on the pass, under its own heat lamp, glows a little warmer than the rest.
   Hovering it says "Press E to taste" instead of opening a panel.
2. **The bite.** The interface fades away.
   The camera pushes in on the plate, a fork lifts, and everything holds still for a breath.
3. **The fall.** The view does a dolly zoom, the field of view opening as the camera rushes in, the way the film's camera rushes at Ego.
   The kitchen washes out to warm white.
4. **The memory.** A small scene in the same low-poly style fades up: a place from Daniel's childhood, in afternoon light through one window, someone at a stove with their back turned, a plate set at a table.
   The camera drifts slowly.
   One or two lines in the house serif fade in and out, written by Daniel: where and when, and what it taught him.
5. **The return.** The memory blurs back to white and the kitchen returns, at the pass, the plate now half eaten.
   A card in the style of a critic's note gives Daniel's one-line philosophy, and Chef Skinner, for once, says something kind in chat.
6. **Afterwards.** A new entry unlocks at the pass ("Why I cook", or "Why I build"), for anyone who wants to read more.

Any key or click after the first two seconds skips straight to the return, and Esc always does.

## Choices to make

1. **Which memory, and which dish.**
   The five plates already on the pass are Daniel's favorites (char siu, beetroot, roti, ricotta toast, truffle croissant).
   The flashback is strongest attached to one of them, with a real memory behind it, rather than to a literal ratatouille.
   A ratatouille could also be added as a sixth plate for the reference.
2. **What the memory is made of.**
   - A small 3D diorama of the place, built like the rest of the world: the most immersive, and on style.
   - A real photo, shown like a print in warm light with slow parallax: the most personal, and quick to make.
   - Both: the diorama, with the photo framed on its wall. This is the recommendation.
3. **One memory, or one per plate.**
   One is a moment.
   Five are a collection ("taste everything on the pass"), which gives people a reason to come back and explore.
   Starting with one and adding more later costs nothing extra.
4. **Safe while tasting?**
   Chef Skinner already leaves anyone standing still alone.
   Other players' knives could still knock someone out of the memory.
   Making tasters immune needs the server to know about it: a protocol change and a deploy of the room server.

## How it would be built

- The memory is its own small scene, loaded only the first time someone tastes, so it costs nothing for anyone who does not.
- During the flashback that scene is drawn instead of the kitchen, so it is no heavier than normal play.
- The sequence is a short timeline (push in, hold, dolly zoom, crossfade, captions, return) in one new module, driven from the same frame loop as everything else.
- Captions are real text, so screen readers get them.
  With reduce motion on, the dolly zoom and camera moves become plain crossfades.
- Other players see the taster standing at the pass with a fork, and the kill feed and chat carry on as normal.
- Tests: an E2E test that tastes, checks the memory and its captions appear, skips, and checks the player is back at the pass in control; unit tests for the timeline.
- If sound is added later, the moment wants its own original music cue (not the film's score).

## What is needed from Daniel

- The memory: where, when, who, and why it matters, in a few sentences.
- One to three short lines for the captions (a draft can be written from the above for Daniel to edit).
- Optionally a photo, and permission to use it.
- Answers to the four choices above.
