import type { DishId, StationId } from '@world/shared';
import beetrootPhoto from './assets/dishes/beetroot.webp';
import charSiuPhoto from './assets/dishes/char-siu.webp';
import ricottaToastPhoto from './assets/dishes/ricotta-toast.webp';
import rotiPhoto from './assets/dishes/roti.webp';
import truffleCroissantPhoto from './assets/dishes/truffle-croissant.webp';

/**
 * Every piece of personal content on the site lives here, taken from Daniel's resume.
 * The 3D kitchen (`stations` and `dishes`) and the plain portfolio page (`lore`, and the dishes)
 * both render from this file and share the same items, so a change to a role or a project shows up
 * in both.
 *
 * The few places that still want Daniel's own words are marked TODO(daniel).
 * Never publish the graduation date or the phone number here.
 */

export interface LoreLink {
  readonly label: string;
  readonly href: string;
}

export interface LoreItem {
  readonly title: string;
  /** A line under the title: the role and the city, or what a project is. */
  readonly subtitle?: string;
  /** Short line beside the title, for example a date range or a place. */
  readonly meta?: string;
  readonly description?: string;
  /** Bullet points, as on a resume. */
  readonly points?: readonly string[];
  readonly href?: string;
  /** The tech stack, shown as one line of small words split by dots. */
  readonly tags?: readonly string[];
}

export interface LoreImage {
  readonly src: string;
  /** What the photo shows, for screen readers and when it fails to load. */
  readonly alt: string;
}

/** A section of the resume, as the portfolio page has it. */
export interface LoreSection {
  readonly id: string;
  /** The heading: of a portfolio section, of a station's panel and its label in the kitchen, or a dish. */
  readonly title: string;
  /** A photo shown above the text. */
  readonly image?: LoreImage;
  readonly paragraphs?: readonly string[];
  readonly items?: readonly LoreItem[];
  readonly tags?: readonly string[];
  readonly links?: readonly LoreLink[];
}

/** What a station or a dish in the kitchen says when it is opened. */
export interface LoreEntry extends LoreSection {
  /** The color of the small light on it while it is under the crosshair, as a CSS hex color. */
  readonly color: string;
  /** Where a dish is from, the restaurant and its city: the line under its name. */
  readonly place?: string;
}

/** How to reach Daniel. Never the phone number. */
const links: readonly LoreLink[] = [
  { label: 'Email', href: 'mailto:dkim927@uchicago.edu' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/doyoondanielkim' },
  { label: 'GitHub', href: 'https://github.com/danielk927' },
];

export const site = {
  name: 'Doyoon (Daniel) Kim',
  headline: 'CS + Statistics @ UChicago',
  intro: 'This is the plain version of my site: everything in the 3D kitchen, none of the walking.',
  links,
} as const;

// ---------- The resume, item by item ----------

const aboutParagraphs = [
  'Hi, I am Daniel. I study computer science and statistics at the University of Chicago, and I build from the GPU up: an LLM inference engine in C++ and CUDA, a synthetic data engine for microscopy, and gesture-controlled rehab games.',
  'I have built LLM evaluation pipelines as an engineering intern at Anto Biosciences (YC F25), modeled thermal performance in fruit flies as a research assistant at UCLA, and won Best Hardware at LAHacks 2026 with a Braille transcriber.',
  'Away from the keyboard I am on the Hong Kong National Kendo Team, and I love to cook, bake and eat. Welcome to my kitchen.',
];

const anto: LoreItem = {
  title: 'Anto Biosciences (YC F25)',
  subtitle: 'Engineering Intern · San Francisco, CA',
  meta: 'Oct 2025 - Apr 2026',
  points: [
    'Developed a Python ETL pipeline on the MIT SuperCloud cluster for LLM-as-a-judge evaluation: regex parsing, structured JSON extraction, rating normalization and validation heuristics across 1,200+ papers.',
    'Engineered system prompts with structured evaluation rubrics, which boosted prediction accuracy from 46% to 73%.',
    'Authored 7 data visualizations and scientific figures for preprints on tokenization methods in machine learning and on deep reinforcement learning for data sparsification, papers pending for NeurIPS and Nature.',
  ],
  tags: ['Python', 'MIT SuperCloud', 'LLM-as-a-judge', 'Prompt engineering'],
};

const uclaLab: LoreItem = {
  title: 'University of California, Los Angeles',
  subtitle: 'Undergraduate Research Assistant · Los Angeles, CA',
  meta: 'Jan 2026 - present',
  points: [
    'Engineered thermal performance curve models with rTPC in R and Python scripts (Pandas and SciPy), and visualized the results in Matplotlib to find the thermal optimum zone in Drosophila. Paper pending for Science Advances.',
    'Created a data preprocessing pipeline in Pandas and NumPy to clean and normalize heterogeneous sleep data.',
  ],
  tags: ['R', 'rTPC', 'Python', 'Pandas', 'SciPy', 'NumPy', 'Matplotlib'],
};

const readingProgram: LoreItem = {
  title: 'Math Directed Reading Program',
  subtitle: 'Mentored by William Chang, UCLA Applied Math Ph.D. student',
  meta: 'Jan 2026 - present',
  points: [
    'Authored 2 research papers on bilevel optimization with SGD and functional scaling laws in feature learning, papers pending for AAAI and AISTATS.',
  ],
};

const inferenceEngine: LoreItem = {
  title: 'LLM Inference Engine',
  subtitle: 'C++/CUDA model serving',
  meta: 'Sep 2026 - present',
  points: [
    'Built a C++/CUDA transformer inference runtime with custom kernels, cuBLAS matrix multiplication and KV-cached decoding, and validated intermediate activations and output logits against a PyTorch reference.',
    'Implemented paged KV-cache allocation, continuous batching and chunked prefill for variable-length requests, with reproducible benchmarks of prefill latency, decode throughput and GPU memory usage.',
  ],
  tags: ['C++', 'CUDA', 'cuBLAS', 'PyTorch'],
};

const generativeOmics: LoreItem = {
  title: 'Generative Omics',
  subtitle: 'Synthetic data engine for biomedical segmentation',
  meta: 'Aug 2026 - present',
  points: [
    'Built a synthetic data platform that converted measured cell morphology into 1,000+ labeled microscopy images, reducing dataset preparation time by 39% through procedural cell modeling and physics-based rendering.',
    'Increased dataset generation throughput from 10 to 15 image-mask pairs a minute with parallel batch workers behind an asynchronous FastAPI service, with object storage and PostgreSQL metadata tracking.',
  ],
  tags: ['FastAPI', 'PostgreSQL', 'Object storage', 'Physics-based rendering'],
};

const sync: LoreItem = {
  title: 'Sync',
  subtitle: 'AI neurorehabilitation platform',
  meta: 'May - Aug 2026',
  points: [
    "Built 10+ gesture-controlled rehab games with Three.js and MediaPipe for real-time pose tracking, backed by PostgreSQL with row-level security to keep each patient's data apart, and deployed on Vercel and Cloudflare.",
    'Deployed to 3 NGO pilots in Hong Kong, with 1,400+ waitlist signups and investment offers from 2 angels.',
  ],
  tags: ['Three.js', 'MediaPipe', 'PostgreSQL', 'Vercel', 'Cloudflare'],
};

const bridge: LoreItem = {
  title: 'Bridge',
  subtitle: 'Real-time image and audio to Braille transcriber',
  meta: 'Apr 2026',
  points: [
    'Best Hardware Award: 1st place out of 300+ teams at LAHacks 2026.',
    'Engineered the pipeline with Faster-Whisper, the Claude API and a custom 3D-printed Braille encoder on an ESP32.',
  ],
  tags: ['Faster-Whisper', 'Claude API', 'ESP32', '3D printing'],
};

const thisKitchen: LoreItem = {
  title: "Daniel's World",
  subtitle: 'This multiplayer 3D kitchen',
  meta: '2026',
  href: 'https://github.com/danielk927/daniel-world',
  description:
    'A first-person personal site where every visitor is a cook in a classical French brigade kitchen, built from primitives in Three.js, with a WebSocket room server so everyone in it sees each other in real time.',
  points: [
    'Client and server run the same deterministic 60 Hz movement simulation, with client-side prediction and reconciliation, so moving feels instant and every screen agrees.',
    "The computer on the chef's desk runs the original DOOM on a RISC-V (RV32IM) machine written in TypeScript: DOOM's C source cross-compiled bare metal against a hand-written libc, and a JIT that translates RISC-V into JavaScript at about 3 billion guest instructions a second, in a Web Worker.",
  ],
  tags: ['TypeScript', 'Three.js', 'Node.js', 'WebSockets', 'RISC-V', 'C'],
};

const skills: readonly LoreItem[] = [
  {
    title: 'Languages',
    tags: ['C++', 'Python', 'JavaScript', 'TypeScript', 'HTML/CSS', 'R', 'SQL'],
  },
  {
    title: 'Libraries and frameworks',
    tags: [
      'PyTorch',
      'cuBLAS',
      'CUDA',
      'NumPy',
      'Pandas',
      'Matplotlib',
      'MediaPipe',
      'React',
      'FastAPI',
      'Node.js',
    ],
  },
  { title: 'Tools', tags: ['Git', 'Docker', 'PostgreSQL', 'GitHub'] },
];

const education: readonly LoreItem[] = [
  {
    title: 'University of Chicago',
    subtitle: 'B.S. Computer Science, B.S. Statistics',
    meta: 'Chicago, IL',
    description:
      'Activities: Hong Kong National Kendo Team, Financial Markets Program, Susquehanna Virtual Discovery Day.',
  },
  {
    title: 'University of California, Los Angeles',
    subtitle: 'B.S. Computational Biology, transferred',
    meta: 'Los Angeles, CA',
  },
];

/** The interests, as paragraphs and the resume's own list. */
const interests = {
  paragraphs: [
    'I am on the Hong Kong National Kendo Team.',
    'I love to cook and bake, hence the kitchen, and to eat: my five favorite dishes are on the pass, and I keep my restaurant rankings on Beli.',
    // TODO(daniel): a line of your own here, for example your team or a favorite designer.
    'I also watch the NBA, and I am into fashion.',
  ],
  tags: ['Kendo', 'Cooking and baking', 'Eating', 'Beli', 'Watching the NBA', 'Fashion'],
} as const;

// ---------- The portfolio page ----------

/** The sections of the portfolio page, in order: a resume, then how the kitchen works. */
export const lore: readonly LoreSection[] = [
  {
    id: 'about',
    title: 'About',
    paragraphs: aboutParagraphs,
  },
  {
    id: 'experience',
    title: 'Experience',
    items: [anto],
  },
  {
    id: 'projects',
    title: 'Projects',
    items: [inferenceEngine, generativeOmics, sync, bridge, thisKitchen],
  },
  {
    id: 'research',
    title: 'Research',
    items: [uclaLab, readingProgram],
  },
  { id: 'skills', title: 'Skills', items: skills },
  {
    id: 'education',
    title: 'Education',
    items: education,
  },
  {
    id: 'interests',
    title: 'Interests',
    ...interests,
  },
  {
    id: 'contact',
    title: 'Contact',
    paragraphs: [
      'Email is the best way to reach me. I am happy to talk about anything in this kitchen.',
    ],
    links,
  },
  {
    id: 'guest-notes',
    title: 'Kitchen notes',
    paragraphs: [
      'Everyone visiting right now is in the kitchen with you. WASD walks, the mouse looks around, Space jumps and Shift sprints.',
      'E opens the station you are looking at. A left click throws a knife; Q swaps it for your bare hand, which punches instead, and I inspects it.',
      'Enter opens the chat, and Esc the menu, where you can start a party and share its party code with friends. Nothing is stored: when everyone leaves a party, it is gone.',
    ],
  },
];

// ---------- The kitchen ----------

export type DishContent = Readonly<Record<DishId, LoreEntry>>;

/**
 * What each plate on the pass says when it is clicked: Daniel's five favorite dishes, with his own
 * photos of them and where each is from.
 * TODO(daniel): add a line of your own to any of them, for example when you ate it and with whom.
 */
export const dishes: DishContent = {
  'char-siu': {
    id: 'char-siu',
    title: 'Char siu',
    place: 'Kamcentre Roast Goose, Hong Kong',
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
    place: 'The Four Horsemen, Brooklyn',
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
    place: 'Kabawa, New York',
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
    place: 'Theodora, Brooklyn',
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
    place: 'Kasama, Chicago',
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

export type StationContent = Readonly<Record<StationId, LoreEntry>>;

/**
 * What each station's panel says when it is opened in the kitchen. Each station of the brigade
 * serves the part of the resume that suits its work: the pass, the first thing a visitor sees,
 * introduces Daniel; the saucier, the senior station, holds his experience; the plonge, where every
 * cook starts and by the door to the dining room, holds his education and how to reach him.
 */
export const stations: StationContent = {
  // Le passe, the pass.
  passe: {
    id: 'passe',
    title: 'About me',
    color: '#ffb86b',
    paragraphs: [
      ...aboutParagraphs,
      'Tonight the pass holds my five favorite dishes of all time, each one from a meal I actually ate.',
    ],
    // The dishes by their own names and restaurants, so the list and their panels say the same.
    items: Object.values(dishes).map((dish) => ({ title: dish.title, meta: dish.place })),
  },
  // Saucier, sauces.
  saucier: {
    id: 'saucier',
    title: 'Experience',
    color: '#e8a25c',
    items: [anto],
  },
  // Poissonnier, fish.
  poissonnier: {
    id: 'poissonnier',
    title: 'Research',
    color: '#7ec8e3',
    items: [uclaLab, readingProgram],
  },
  // Rôtisseur, roasts.
  rotisseur: {
    id: 'rotisseur',
    title: 'Systems and ML',
    color: '#e07a5f',
    paragraphs: ['Projects in systems and machine learning, both still cooking.'],
    items: [inferenceEngine, generativeOmics],
  },
  // Entremetier, vegetables.
  entremetier: {
    id: 'entremetier',
    title: 'Products',
    color: '#8fd18a',
    paragraphs: ['Projects built for people to use, from a hackathon weekend to NGO pilots.'],
    items: [sync, bridge, thisKitchen],
  },
  // Garde manger, the cold kitchen.
  'garde-manger': {
    id: 'garde-manger',
    title: 'Skills',
    color: '#9fd8ef',
    items: skills,
  },
  // Pâtisserie, pastry.
  patisserie: {
    id: 'patisserie',
    title: 'Interests',
    color: '#f4a6c6',
    ...interests,
  },
  // Plonge, the dish pit.
  plonge: {
    id: 'plonge',
    title: 'Education and contact',
    color: '#a9b8ff',
    paragraphs: [
      'Every cook starts here, by the door to the dining room, so here is where I study and how to reach me. Email is the best way.',
    ],
    items: education,
    links,
  },
};
