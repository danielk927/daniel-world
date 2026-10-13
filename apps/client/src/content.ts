import type { DishId, StationId } from '@world/shared';
import beetrootPhoto from './assets/dishes/beetroot.webp';
import charSiuPhoto from './assets/dishes/char-siu.webp';
import ricottaToastPhoto from './assets/dishes/ricotta-toast.webp';
import rotiPhoto from './assets/dishes/roti.webp';
import truffleCroissantPhoto from './assets/dishes/truffle-croissant.webp';

/**
 * Every piece of personal content in the 3D kitchen lives here, taken from Daniel's resume: what
 * the stations and the dishes say when they are opened. The resume itself is a PDF kept as it is in
 * `public/` (`resume.ts`), so a change to a role or a project is made in both places.
 *
 * Never put the graduation date or the phone number here (the resume PDF has them, as Daniel chose).
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
  /** The file's size in pixels, so the panel keeps the photo's shape before it loads. */
  readonly width: number;
  readonly height: number;
}

/** A section of the resume, as a station's panel or a dish shows it. */
export interface LoreSection {
  readonly id: string;
  /** The heading: of a station's panel and its label in the kitchen, or of a dish. */
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
} as const;

// ---------- The resume, item by item ----------

const aboutParagraphs = [
  'Hi, my name is Daniel! My family is originally from Korea, but I moved to Hong Kong at a young age and graduated high school there. I initially attended UCLA my first year, but transferred to the University of Chicago for my second year, where I now study computer science and statistics.',
  "I'm interested in all things LLM, especially to do with inference. I'm currently working on making a smaller and simpler vLLM by making my own C++/CUDA LLM inference engine. I'm also extremely interested in startups, having worked at Anto Biosciences (YC F25) as an engineering intern and always building.",
  "I also love cooking and eating, hence the theme of this website. Previously, I worked at a 1-Michelin star French restaurant and an Italian restaurant in Hong Kong. I'm also extremely active on Beli (follow me @danielk927), where you can find the best restaurant recommendations. These 5 dishes on the pass are my top 5 favorite dishes of all time.",
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
};

const uclaLab: LoreItem = {
  title: 'University of California, Los Angeles',
  subtitle: 'Undergraduate Research Assistant · Los Angeles, CA',
  meta: 'Jan 2026 - present',
  points: [
    'Engineered thermal performance curve models with rTPC in R and Python scripts (Pandas and SciPy), and visualized the results in Matplotlib to find the thermal optimum zone in Drosophila. Paper pending for Science Advances.',
    'Created a data preprocessing pipeline in Pandas and NumPy to clean and normalize heterogeneous sleep data.',
  ],
  tags: ['R', 'Python', 'Pandas', 'SciPy', 'NumPy', 'Matplotlib'],
};

const readingProgram: LoreItem = {
  title: 'Math Directed Reading Program',
  subtitle: 'Mentored by William Chang, UCLA Applied Math Ph.D. student',
  meta: 'Jan 2026 - present',
  points: [
    'Authored 2 research papers on bilevel optimization with SGD and functional scaling laws in feature learning.',
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
  tags: ['FastAPI', 'PostgreSQL'],
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
  tags: ['Faster-Whisper', 'Claude API', 'ESP32'],
};

const thisKitchen: LoreItem = {
  title: "Daniel's World",
  subtitle: 'This multiplayer 3D kitchen',
  meta: '2026',
  points: [
    'Synced 16 concurrent players per room in real time with zero client-server desyncs under load by building a server-authoritative Node.js WebSocket server with client-side prediction over a deterministic simulation.',
    'Implemented AWS as infra in CDK, with WebSockets proxied via CloudFront to a self-healing EC2 origin.',
    "Ran the game DOOM in the browser by writing a RISC-V emulator and a JIT compiler to JavaScript that runs 18x faster than its interpreter, and cross-compiling DOOM's C source bare-metal against a from-scratch libc.",
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

/** The hackathons, each with what came of it, and the ones still to come. */
const hackathons: readonly LoreItem[] = [
  { title: 'LAHacks 2026', meta: 'Best Hardware Award' },
  { title: 'UCLA Whopathon', meta: 'Best Overall Award' },
  { title: 'SoCal Claude Builder Hackathon', meta: '1 of 100 selected' },
  { title: 'LAHacks AI Hackathon 2026', meta: 'Pending' },
  { title: 'CalHacks 2026', meta: 'Pending' },
];

// ---------- The kitchen ----------

export type DishContent = Readonly<Record<DishId, LoreEntry>>;

/**
 * What each plate on the pass says when it is clicked: Daniel's five favorite dishes, with his own
 * photos of them, where each is from, and what he thought of it.
 */
export const dishes: DishContent = {
  'char-siu': {
    id: 'char-siu',
    title: 'Assorted Char Siu',
    place: 'Kamcentre Roast Goose, Hong Kong',
    color: '#c0533a',
    image: {
      src: charSiuPhoto,
      alt: 'A plate of glazed, charred char siu at Kamcentre Roast Goose',
      width: 675,
      height: 1200,
    },
    paragraphs: [
      'Cantonese barbecued pork, roasted with honey maltose glaze and nicely charred at the edges.',
      "Kamcentre is a roast meat restaurant in the South China Athletic Association in Causeway Bay, and it is my favorite restaurant in Hong Kong. I've been to countless restaurants serving char siu, including Yat Lok (1-Michelin star, personally had a terrible experience there) and Sun Kwai Heung (many people think they have the best char siu, but I personally found it too sweet). I will forever stand by the fact that the char siu here is by far the best in the world.",
    ],
  },
  beetroot: {
    id: 'beetroot',
    title: 'Glazed Beetroot and La Tur',
    place: 'The Four Horsemen, Brooklyn',
    color: '#b8325a',
    image: {
      src: beetrootPhoto,
      alt: 'Glazed beets beside a spoon of La Tur cheese on a white plate at The Four Horsemen',
      width: 360,
      height: 480,
    },
    paragraphs: [
      'Soft, deeply caramelized beets in a glaze of brown butter, next to a spoon of La Tur, a creamy Piedmontese cheese of cow, sheep and goat milk.',
      "The Four Horsemen is a wine bar based in Williamsburg, Brooklyn. I've been following the restaurant for quite some time, even buying their physical cookbook, and when I finally snagged a reservation and ate there, everything blew my mind. It was the best, most complete meal of my life. I've also been to their sister restaurant next door, I Cavallini, but I found The Four Horsemen to be a better experience.",
    ],
  },
  roti: {
    id: 'roti',
    title: 'Roti and Dips',
    place: 'Kabawa, New York',
    color: '#d98a3a',
    image: {
      src: rotiPhoto,
      alt: 'Flaky roti with small bowls of curried chickpeas, pepper sauce and chutney at Kabawa',
      width: 900,
      height: 1200,
    },
    paragraphs: [
      'Flaky, buttery roti made fresh to tear and dip into curried chickpeas, pepper jelly and fruit chutneys.',
      'Kabawa is a Caribbean restaurant in the East Village, offering a $150 prix fixe course meal. I was so mind-blown by the pepper jelly dip that I asked the chef there how they made it. We wiped every single plate clean.',
    ],
  },
  'ricotta-toast': {
    id: 'ricotta-toast',
    title: 'Ricotta Toast',
    place: 'Theodora, Brooklyn',
    color: '#c9a04a',
    image: {
      src: ricottaToastPhoto,
      alt: 'Sourdough toast piped with whipped ricotta, honey and black pepper at Theodora',
      width: 900,
      height: 1200,
    },
    paragraphs: [
      'Thick sourdough from Thea, its sister bakery, piped with whipped ricotta and finished with brown butter, honey, sage and black pepper.',
      "Theodora is chef Tomer Blechman's Mediterranean restaurant in Fort Greene, Brooklyn. Their focus is on wood-fire cooking, so all their vegetables and meats are cooked on an open fire. The thing that truly stood out to me was their ricotta toast; it was the craziest, most balanced flavor bomb. My friends really liked their mackerel toast, so I would recommend that as well.",
    ],
  },
  'truffle-croissant': {
    id: 'truffle-croissant',
    title: 'Black Truffle Croissant',
    place: 'Kasama, Chicago',
    color: '#8a6a3a',
    image: {
      src: truffleCroissantPhoto,
      alt: 'A croissant under pearl sugar and shaved black truffle, in a takeaway box from Kasama',
      width: 900,
      height: 1200,
    },
    paragraphs: [
      'Laminated with European butter, filled with a decadent black truffle filling, then finished with honey, pearl sugar and shaved black truffle.',
      "Kasama is a Filipino bakery by day and a tasting menu restaurant by night. It is the only 2-Michelin starred Filipino restaurant in the world! I initially had pretty low expectations because I thought this was the continuation of the trend of forcing truffle onto dishes, but the truffle taste was subtle and complemented the flaky croissant surprisingly well. Their breakfast sandwich is also another item they're known for, and the sandwich is super good.",
    ],
  },
};

export type StationContent = Readonly<Record<StationId, LoreEntry>>;

/**
 * What each station's panel says when it is opened in the kitchen. Each station of the brigade
 * serves the part of the resume that suits its work: the pass, the first thing a visitor sees,
 * introduces Daniel; the saucier, the senior station, holds his experiences; the plonge, where every
 * cook starts and by the door to the dining room, holds his education and how to reach him. The
 * pâtisserie holds nothing: it is only the kitchen's pastry corner.
 */
export const stations: StationContent = {
  // Le passe, the pass.
  passe: {
    id: 'passe',
    title: 'About me',
    color: '#ffb86b',
    paragraphs: aboutParagraphs,
    // The dishes by their own names and restaurants, so the list and their panels say the same.
    items: Object.values(dishes).map((dish) => ({ title: dish.title, meta: dish.place })),
  },
  // Saucier, sauces.
  saucier: {
    id: 'saucier',
    title: 'Experiences',
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
    title: 'Projects',
    color: '#e07a5f',
    items: [thisKitchen, inferenceEngine, generativeOmics, sync, bridge],
  },
  // Entremetier, vegetables.
  entremetier: {
    id: 'entremetier',
    title: 'Hackathons',
    color: '#8fd18a',
    items: hackathons,
  },
  // Garde manger, the cold kitchen.
  'garde-manger': {
    id: 'garde-manger',
    title: 'Skills',
    color: '#9fd8ef',
    items: skills,
  },
  // Plonge, the dish pit.
  plonge: {
    id: 'plonge',
    title: 'Education',
    color: '#a9b8ff',
    items: education,
    links,
  },
};
