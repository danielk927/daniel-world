const ADJECTIVES = [
  'Brave',
  'Cosmic',
  'Curious',
  'Dapper',
  'Dizzy',
  'Fuzzy',
  'Gentle',
  'Golden',
  'Happy',
  'Jolly',
  'Lucky',
  'Mellow',
  'Nimble',
  'Plucky',
  'Quiet',
  'Rusty',
  'Sleepy',
  'Snappy',
  'Sunny',
  'Swift',
  'Tiny',
  'Witty',
  'Zesty',
  'Breezy',
];

const ANIMALS = [
  'Otter',
  'Fox',
  'Panda',
  'Koala',
  'Heron',
  'Lynx',
  'Badger',
  'Gecko',
  'Moose',
  'Puffin',
  'Quokka',
  'Raccoon',
  'Sloth',
  'Tapir',
  'Walrus',
  'Yak',
  'Axolotl',
  'Capybara',
  'Ferret',
  'Narwhal',
  'Owl',
  'Penguin',
  'Seal',
  'Wombat',
];

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

export function randomName(): string {
  return `${pick(ADJECTIVES)} ${pick(ANIMALS)}`;
}
