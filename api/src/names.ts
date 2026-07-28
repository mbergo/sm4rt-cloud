const ADJECTIVES = [
  'amber', 'bold', 'brisk', 'calm', 'clever', 'cosmic', 'crisp', 'eager',
  'fleet', 'gentle', 'golden', 'happy', 'keen', 'lively', 'lunar', 'mellow',
  'nimble', 'polar', 'quiet', 'rapid', 'solar', 'sturdy', 'swift', 'vivid',
];

const ANIMALS = [
  'badger', 'bison', 'condor', 'coyote', 'dolphin', 'falcon', 'gecko',
  'heron', 'ibis', 'jaguar', 'koala', 'lemur', 'lynx', 'marmot', 'narwhal',
  'otter', 'panda', 'parakeet', 'puffin', 'quokka', 'raven', 'tapir',
  'toucan', 'wombat',
];

const NAME_PATTERN = /^[a-z](?:[a-z0-9-]{0,26}[a-z0-9])?$/;

export function isValidName(name: string): boolean {
  return NAME_PATTERN.test(name) && !name.includes('--');
}

export function randomName(taken: Set<string>): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
    const candidate = `${adjective}-${animal}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  return `floci-${Date.now().toString(36)}`;
}
