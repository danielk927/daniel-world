/**
 * Every piece of personal content on the site lives here.
 * The 3D world (lore objects) and the static portfolio page both render from this file.
 *
 * Placeholders are marked with TODO(daniel). Search for that tag and replace each one.
 */

export type LoreShape =
  | 'icosahedron'
  | 'torusKnot'
  | 'octahedron'
  | 'dodecahedron'
  | 'torus'
  | 'cube'
  | 'cone'
  | 'capsule';

export interface LoreLink {
  readonly label: string;
  readonly href: string;
}

export interface LoreItem {
  readonly title: string;
  /** Short secondary line, for example a date range or role. */
  readonly meta?: string;
  readonly description?: string;
  readonly href?: string;
  readonly tags?: readonly string[];
}

export interface LoreEntry {
  readonly id: string;
  /** Label on the floating object and heading of the info panel. */
  readonly title: string;
  /** One line shown under the title. */
  readonly kicker: string;
  readonly shape: LoreShape;
  /** Accent color of the object and its panel, as a CSS hex color. */
  readonly color: string;
  readonly paragraphs?: readonly string[];
  readonly items?: readonly LoreItem[];
  readonly tags?: readonly string[];
  readonly links?: readonly LoreLink[];
}

export const site = {
  name: 'Daniel Kim',
  worldName: "Daniel's World",
  // TODO(daniel): one-line tagline shown on the landing screen and portfolio header.
  tagline: 'A tiny floating island about who I am and what I build. Come say hi.',
  // TODO(daniel): short intro for the top of the portfolio page.
  intro:
    'Hi, I am Daniel. This is the plain version of my site: same content as the 3D world, none of the walking.',
} as const;

/**
 * The lore objects, in the order they sit around the plaza (clockwise, starting to the left of
 * the fountain as seen from the spawn point). The world has exactly eight pedestals.
 */
export const lore: readonly LoreEntry[] = [
  {
    id: 'about',
    title: 'About',
    kicker: 'Who I am',
    shape: 'icosahedron',
    color: '#ffb86b',
    paragraphs: [
      // TODO(daniel): replace with a real introduction.
      'I am a builder who likes turning fuzzy ideas into things people can touch. This paragraph is a placeholder for a short, friendly introduction.',
      // TODO(daniel): replace with where you are and what you are doing now.
      'Currently studying and building side projects. Replace this with where you are, what you are learning, and what gets you excited.',
    ],
  },
  {
    id: 'projects',
    title: 'Projects',
    kicker: 'Things I have made',
    shape: 'torusKnot',
    color: '#7ad7c4',
    items: [
      // TODO(daniel): replace each project with real ones (title, one-liner, link, tags).
      {
        title: 'This world',
        meta: '2026',
        description:
          'A multiplayer 3D personal site built with Three.js and a tiny WebSocket server. You are standing in it.',
        tags: ['TypeScript', 'Three.js', 'WebSockets'],
      },
      {
        title: 'Project Two',
        meta: 'Year',
        description: 'One sentence about what it does and why it was interesting to build.',
        tags: ['Tag', 'Tag'],
      },
      {
        title: 'Project Three',
        meta: 'Year',
        description: 'One sentence about the problem, your role, and the outcome.',
        tags: ['Tag'],
      },
    ],
  },
  {
    id: 'experience',
    title: 'Experience',
    kicker: 'Where I have worked',
    shape: 'octahedron',
    color: '#9fb4ff',
    items: [
      // TODO(daniel): replace with real roles, most recent first.
      {
        title: 'Role, Organization',
        meta: 'Start - End',
        description: 'What you worked on and what changed because of it.',
      },
      {
        title: 'Role, Organization',
        meta: 'Start - End',
        description: 'A second role, internship, research position, or club.',
      },
    ],
  },
  {
    id: 'skills',
    title: 'Skills',
    kicker: 'Tools of the trade',
    shape: 'dodecahedron',
    color: '#c3a6ff',
    paragraphs: [
      // TODO(daniel): replace with a sentence about how you like to work.
      'A mix of things I use every day and things I am getting better at.',
    ],
    // TODO(daniel): replace with your real skills.
    tags: ['TypeScript', 'Python', 'React', 'Three.js', 'Node.js', 'SQL', 'Git', 'Figma'],
  },
  {
    id: 'contact',
    title: 'Contact',
    kicker: 'Say hello',
    shape: 'torus',
    color: '#ff8fa3',
    paragraphs: [
      // TODO(daniel): replace with how you would like people to reach you.
      'The best way to reach me is email. I am always happy to talk about projects, internships, or anything on this island.',
    ],
    links: [
      // TODO(daniel): replace with real links.
      { label: 'Email', href: 'mailto:hello@example.com' },
      { label: 'GitHub', href: 'https://github.com/' },
      { label: 'LinkedIn', href: 'https://www.linkedin.com/' },
    ],
  },
  {
    id: 'now',
    title: 'Now',
    kicker: 'What I am into lately',
    shape: 'cube',
    color: '#ffd76b',
    items: [
      // TODO(daniel): replace with what you are currently reading, playing, or learning.
      { title: 'Reading', description: 'A book you are reading right now.' },
      { title: 'Playing', description: 'A game you keep coming back to.' },
      { title: 'Learning', description: 'Something new you are picking up.' },
    ],
  },
  {
    id: 'fun-facts',
    title: 'Fun facts',
    kicker: 'Assorted trivia',
    shape: 'cone',
    color: '#8fe388',
    items: [
      // TODO(daniel): replace with real fun facts.
      { title: 'Fact one', description: 'Something surprising about you.' },
      { title: 'Fact two', description: 'A hobby, a record, or a strong opinion about snacks.' },
      {
        title: 'Fact three',
        description: 'The island has exactly eight of these objects. Did you find them all?',
      },
    ],
  },
  {
    id: 'guest-notes',
    title: 'Island notes',
    kicker: 'How this place works',
    shape: 'capsule',
    color: '#6bc7ff',
    paragraphs: [
      'Everyone visiting right now is on the island with you. Press Enter to chat, and 1, 2 or 3 to wave, dance or jump.',
      'Share a room code with friends to get a private island. Nothing is stored: when everyone leaves, the room is gone.',
    ],
  },
];
