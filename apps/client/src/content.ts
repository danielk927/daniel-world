import type { DishId, StationId } from '@world/shared';
import beetrootPhoto from './assets/dishes/beetroot.webp';
import charSiuPhoto from './assets/dishes/char-siu.webp';
import ricottaToastPhoto from './assets/dishes/ricotta-toast.webp';
import rotiPhoto from './assets/dishes/roti.webp';
import truffleCroissantPhoto from './assets/dishes/truffle-croissant.webp';

/**
 * Every piece of personal content on the site lives here.
 * The 3D kitchen (stations) and the static portfolio page both render from this file.
 *
 * Placeholders are marked with TODO(daniel). Search for that tag and replace each one.
 */

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

export interface LoreImage {
  readonly src: string;
  /** What the photo shows, for screen readers and when it fails to load. */
  readonly alt: string;
}

export interface LoreEntry {
  readonly id: string;
  /** Label in the world and heading of the info panel. */
  readonly title: string;
  /** One line shown under the title. */
  readonly kicker: string;
  /** Accent color of the label and panel, as a CSS hex color. */
  readonly color: string;
  /** A photo shown above the text. */
  readonly image?: LoreImage;
  readonly paragraphs?: readonly string[];
  readonly items?: readonly LoreItem[];
  readonly tags?: readonly string[];
  readonly links?: readonly LoreLink[];
}

export const site = {
  name: 'Daniel Kim',
  worldName: "Daniel's World",
  // TODO(daniel): one-line tagline shown on the landing screen and portfolio header.
  tagline: 'A classical French kitchen about who I am and what I build. Come cook with me.',
  // TODO(daniel): short intro for the top of the portfolio page.
  intro:
    'Hi, I am Daniel. This is the plain version of my site: same content as the 3D world, none of the walking.',
} as const;

/** The sections of the portfolio page, in order. */
export const lore: readonly LoreEntry[] = [
  {
    id: 'about',
    title: 'About',
    kicker: 'Who I am',
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
    color: '#ff8fa3',
    paragraphs: [
      // TODO(daniel): replace with how you would like people to reach you.
      'The best way to reach me is email. I am always happy to talk about projects, internships, or anything in this kitchen.',
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
    color: '#8fe388',
    items: [
      // TODO(daniel): replace with real fun facts.
      { title: 'Fact one', description: 'Something surprising about you.' },
      { title: 'Fact two', description: 'A hobby, a record, or a strong opinion about snacks.' },
      {
        title: 'Fact three',
        description: 'The kitchen has eight stations. Did you visit them all?',
      },
    ],
  },
  {
    id: 'guest-notes',
    title: 'Kitchen notes',
    kicker: 'How this place works',
    color: '#6bc7ff',
    paragraphs: [
      'Everyone visiting right now is in the kitchen with you. Press Enter to chat, and 1, 2 or 3 to wave, dance or jump.',
      'Share a room code with friends to get a private kitchen. Nothing is stored: when everyone leaves, the room is gone.',
    ],
  },
];

export type StationContent = Readonly<Record<StationId, LoreEntry>>;

/**
 * What each station's panel says when it is clicked in the kitchen.
 * TODO(daniel): when you are ready, point a station at one of your sections above, for example
 * `saucier: lore[0]!`, and its panel will show that section instead.
 */
export const stations: StationContent = {
  passe: {
    id: 'passe',
    title: 'Le passe',
    kicker: 'The pass',
    color: '#ffb86b',
    paragraphs: [
      'Every plate stops here under the heat lamps for one last look before it goes out to the dining room.',
      'Tonight the pass holds my five favorite dishes of all time, each one from a meal I actually ate.',
    ],
    items: [
      { title: 'Char siu', meta: 'Kamcentre Roast Goose, Hong Kong' },
      { title: 'Glazed beetroot and La Tur', meta: 'The Four Horsemen, Brooklyn' },
      { title: 'Roti and dips', meta: 'Kabawa, New York' },
      { title: 'Ricotta toast', meta: 'Theodora, Brooklyn' },
      { title: 'Truffle croissant', meta: 'Kasama, Chicago' },
    ],
  },
  saucier: {
    id: 'saucier',
    title: 'Saucier',
    kicker: 'Sauces and sautés',
    color: '#e8a25c',
    paragraphs: [
      'The most senior station on the line: stocks, reductions, and the sauces that tie each dish together.',
    ],
  },
  poissonnier: {
    id: 'poissonnier',
    title: 'Poissonnier',
    kicker: 'Fish and shellfish',
    color: '#7ec8e3',
    paragraphs: [
      'Whole fish are scaled, filleted and cooked to the second, along with their sauces.',
    ],
  },
  rotisseur: {
    id: 'rotisseur',
    title: 'Rôtisseur',
    kicker: 'Roasts and braises',
    color: '#e07a5f',
    paragraphs: ['Roasting, braising and grilling, and the jus that comes from them.'],
  },
  entremetier: {
    id: 'entremetier',
    title: 'Entremetier',
    kicker: 'Vegetables, soups and eggs',
    color: '#8fd18a',
    paragraphs: ['Everything from the garden: vegetables, soups, starches and egg dishes.'],
  },
  'garde-manger': {
    id: 'garde-manger',
    title: 'Garde manger',
    kicker: 'The cold kitchen',
    color: '#9fd8ef',
    paragraphs: ['Terrines, pâtés, cheeses, salads and oysters: anything served cold.'],
  },
  patisserie: {
    id: 'patisserie',
    title: 'Pâtisserie',
    kicker: 'Pastry and desserts',
    color: '#f4a6c6',
    paragraphs: ['Breads, viennoiserie and desserts, measured to the gram on cool marble.'],
  },
  plonge: {
    id: 'plonge',
    title: 'Plonge',
    kicker: 'The dish pit',
    color: '#a9b8ff',
    paragraphs: ['Pots, pans and plates. No service survives without it.'],
  },
};

export type DishContent = Readonly<Record<DishId, LoreEntry>>;

/**
 * What each plate on the pass says when it is clicked: Daniel's five favorite dishes, with his own
 * photos of them. The kicker names the restaurant.
 * TODO(daniel): add a line of your own to any of them, for example when you ate it and with whom.
 */
export const dishes: DishContent = {
  'char-siu': {
    id: 'char-siu',
    title: 'Char siu',
    kicker: 'Kamcentre Roast Goose, Hong Kong',
    color: '#c0533a',
    image: {
      src: charSiuPhoto,
      alt: 'A plate of glazed, charred char siu at Kamcentre Roast Goose',
    },
    paragraphs: [
      'Cantonese barbecued pork, roasted until the honey glaze lacquers and blackens at the edges.',
      'Kamcentre is a roast meat restaurant in the South China Athletic Association in Causeway Bay, led by chef Fung Hou Tong, who once ran the roast meats at Yung Kee. Its signature char siu is cut from the pork collar, so some pieces are nearly all fat and the rest are wonderfully juicy.',
    ],
  },
  beetroot: {
    id: 'beetroot',
    title: 'Glazed beetroot and La Tur',
    kicker: 'The Four Horsemen, Brooklyn',
    color: '#b8325a',
    image: {
      src: beetrootPhoto,
      alt: 'Glazed beets beside a spoon of La Tur cheese on a white plate at The Four Horsemen',
    },
    paragraphs: [
      'Soft, deeply caramelized beets in a glaze of brown butter and balsamic, next to a spoon of La Tur, a creamy Piedmontese cheese of cow, sheep and goat milk.',
      'The Four Horsemen is a wine bar and restaurant in Williamsburg. Order the house bread too, to mop up the sauce.',
    ],
  },
  roti: {
    id: 'roti',
    title: 'Roti and dips',
    kicker: 'Kabawa, New York',
    color: '#d98a3a',
    image: {
      src: rotiPhoto,
      alt: 'Flaky roti with small bowls of curried chickpeas, pepper sauce and chutney at Kabawa',
    },
    paragraphs: [
      'Flaky, buttery roti made fresh, to tear and dip into curried chickpeas, pepper jelly and fruit chutneys.',
      "Kabawa is Momofuku's Caribbean restaurant in the East Village, led by chef Paul Carmichael, formerly of Momofuku Seiobo in Sydney.",
    ],
  },
  'ricotta-toast': {
    id: 'ricotta-toast',
    title: 'Ricotta toast',
    kicker: 'Theodora, Brooklyn',
    color: '#c9a04a',
    image: {
      src: ricottaToastPhoto,
      alt: 'Sourdough toast piped with whipped ricotta, honey and black pepper at Theodora',
    },
    paragraphs: [
      'Thick sourdough from Thea, the bakery two doors down, piped with whipped ricotta and finished with brown butter, honey, sage and black pepper.',
      "Theodora is chef Tomer Blechman's wood-fired Mediterranean restaurant in Fort Greene.",
    ],
  },
  'truffle-croissant': {
    id: 'truffle-croissant',
    title: 'Black truffle croissant',
    kicker: 'Kasama, Chicago',
    color: '#8a6a3a',
    image: {
      src: truffleCroissantPhoto,
      alt: 'A croissant under pearl sugar and shaved black truffle, in a takeaway box from Kasama',
    },
    paragraphs: [
      'Laminated with European butter and filled with black truffle and Délice de Bourgogne, then finished with honey, pearl sugar and shaved black truffle.',
      'Kasama, in Ukrainian Village, is a Filipino bakery by day and a tasting menu restaurant by night, run by chefs Tim Flores and Genie Kwon.',
    ],
  },
};
