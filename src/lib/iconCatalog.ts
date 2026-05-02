/**
 * Curated emoji catalog used by the IconPicker.
 *
 *  These are intentionally small, focused buckets — not a full Unicode dump.
 *  The goal is "tap a category, see the obvious choices", not "scroll through
 *  3000 emojis".  Custom typed glyphs remain available as a fallback in the
 *  picker.
 */

export interface IconCategory {
  /** Stable id used as the tab value. */
  id: string;
  /** Short label shown on the tab. */
  label: string;
  /** Glyph used as the visual cue for the tab. */
  tabIcon: string;
  /** Curated list of emoji/glyphs in this category. */
  icons: string[];
}

export const ICON_CATEGORIES: IconCategory[] = [
  {
    id: 'work',
    label: 'Work',
    tabIcon: '💼',
    icons: [
      '💼', '📊', '📈', '📉', '📋', '🗂️', '📁', '📂',
      '📅', '🗓️', '🖇️', '📎', '📌', '📍', '✏️', '🖊️',
      '🧾', '📝', '🗒️', '🗳️', '🏢', '🏭', '🤝', '👔',
    ],
  },
  {
    id: 'personal',
    label: 'Personal',
    tabIcon: '🌟',
    icons: [
      '🌟', '⭐', '✨', '💫', '🔥', '💡', '🎯', '🏆',
      '🎉', '🎊', '🎁', '❤️', '💖', '💭', '🧠', '😀',
      '😎', '🙌', '👍', '👏', '🙏', '🌈', '🌻', '🍀',
    ],
  },
  {
    id: 'school',
    label: 'School',
    tabIcon: '🎓',
    icons: [
      '🎓', '📚', '📖', '📓', '📔', '📕', '📗', '📘',
      '📙', '✏️', '🖊️', '🖋️', '🖍️', '📝', '🧑‍🎓', '🧑‍🏫',
      '🔬', '🧪', '🧫', '🧮', '🌐', '🗺️', '🏫', '🎒',
    ],
  },
  {
    id: 'health',
    label: 'Health',
    tabIcon: '💪',
    icons: [
      '💪', '🏃', '🚴', '🧘', '🏋️', '🤸', '🥗', '🥦',
      '🍎', '🥕', '💧', '☕', '🍵', '😴', '🛏️', '🧴',
      '💊', '🩺', '🧬', '❤️', '🫀', '🧠', '🦷', '🩹',
    ],
  },
  {
    id: 'money',
    label: 'Money',
    tabIcon: '💰',
    icons: [
      '💰', '💵', '💴', '💶', '💷', '💸', '🪙', '💳',
      '🏦', '🧾', '📈', '📉', '📊', '💹', '🏷️', '🛒',
      '🛍️', '💎', '🔑', '📦', '🪪', '🧮', '🪜', '🏠',
    ],
  },
  {
    id: 'creative',
    label: 'Creative',
    tabIcon: '🎨',
    icons: [
      '🎨', '🖌️', '🖍️', '✏️', '🖊️', '📷', '📸', '🎥',
      '🎬', '🎼', '🎵', '🎶', '🎸', '🥁', '🎹', '🎤',
      '🎧', '🎭', '🪄', '🧵', '🧶', '✂️', '📝', '💡',
    ],
  },
  {
    id: 'home',
    label: 'Home',
    tabIcon: '🏠',
    icons: [
      '🏠', '🏡', '🛋️', '🛏️', '🚪', '🪟', '🔑', '🛁',
      '🚿', '🍽️', '🧺', '🧹', '🧼', '🧽', '🪴', '🌱',
      '🪑', '🛒', '🧴', '🪣', '🔧', '🔨', '🪛', '🗝️',
    ],
  },
  {
    id: 'travel',
    label: 'Travel',
    tabIcon: '✈️',
    icons: [
      '✈️', '🛫', '🛬', '🚆', '🚄', '🚌', '🚗', '🚕',
      '🚲', '🛴', '⛵', '🚢', '🗺️', '🧭', '🏖️', '🏝️',
      '🏔️', '🗻', '🏕️', '🎒', '🧳', '🛂', '🛎️', '🌅',
    ],
  },
  {
    id: 'tech',
    label: 'Tech',
    tabIcon: '💻',
    icons: [
      '💻', '🖥️', '🖱️', '⌨️', '🖨️', '📱', '📲', '💾',
      '💿', '📀', '🧠', '🧮', '🧰', '🔌', '🔋', '🛰️',
      '🤖', '🧪', '⚙️', '🛠️', '📡', '🎮', '🕹️', '🧩',
    ],
  },
];

/** Flat, de-duplicated list of all curated icons. */
export const ALL_CURATED_ICONS: string[] = Array.from(
  new Set(ICON_CATEGORIES.flatMap((c) => c.icons)),
);

/**
 * Lightweight keyword index for icons.  Used for the picker's search box so
 * users can type "money" and see 💰, or "code" and see 💻.  Keywords are
 * intentionally short and additive — only icons users are likely to search for.
 */
export const ICON_KEYWORDS: Record<string, string[]> = {
  '💼': ['work', 'briefcase', 'job', 'business'],
  '📊': ['chart', 'stats', 'data', 'analytics'],
  '📈': ['chart', 'growth', 'up', 'trend'],
  '📉': ['chart', 'decline', 'down'],
  '📋': ['clipboard', 'list', 'task'],
  '📁': ['folder', 'files'],
  '📂': ['folder', 'open'],
  '📅': ['calendar', 'date', 'schedule'],
  '🗓️': ['calendar', 'schedule'],
  '📎': ['attachment', 'clip'],
  '📍': ['pin', 'location', 'place'],
  '📝': ['note', 'memo', 'write'],
  '🏢': ['office', 'building', 'company'],
  '👔': ['suit', 'work', 'tie'],
  '🌟': ['star', 'favorite'],
  '⭐': ['star', 'favorite'],
  '🔥': ['fire', 'hot', 'streak'],
  '💡': ['idea', 'lightbulb', 'tip'],
  '🎯': ['target', 'goal', 'focus'],
  '🏆': ['trophy', 'win', 'achievement'],
  '🎉': ['party', 'celebrate'],
  '🎁': ['gift', 'present'],
  '❤️': ['heart', 'love', 'health'],
  '🧠': ['brain', 'think', 'mind'],
  '😀': ['happy', 'smile'],
  '🙏': ['thanks', 'pray'],
  '🌈': ['rainbow'],
  '🍀': ['luck', 'clover'],
  '🎓': ['graduation', 'school', 'study'],
  '📚': ['books', 'study', 'read'],
  '📖': ['book', 'read'],
  '✏️': ['pencil', 'write', 'edit'],
  '🔬': ['microscope', 'science'],
  '🧪': ['test', 'science', 'experiment'],
  '🧮': ['abacus', 'math'],
  '🗺️': ['map', 'travel'],
  '🏫': ['school', 'building'],
  '🎒': ['backpack', 'school'],
  '💪': ['strong', 'workout', 'gym', 'health'],
  '🏃': ['run', 'exercise', 'cardio'],
  '🚴': ['cycle', 'bike', 'cardio'],
  '🧘': ['yoga', 'meditate', 'calm'],
  '🏋️': ['lift', 'gym', 'workout'],
  '🥗': ['salad', 'food', 'healthy'],
  '🥦': ['vegetable', 'broccoli', 'healthy'],
  '🍎': ['apple', 'fruit', 'healthy'],
  '💧': ['water', 'drink', 'hydration'],
  '☕': ['coffee', 'drink'],
  '🍵': ['tea', 'drink'],
  '😴': ['sleep', 'rest'],
  '🛏️': ['bed', 'sleep', 'rest'],
  '💊': ['pill', 'medicine', 'health'],
  '🩺': ['stethoscope', 'doctor', 'health'],
  '💰': ['money', 'cash', 'finance'],
  '💵': ['cash', 'dollar'],
  '💸': ['money', 'spend'],
  '💳': ['card', 'payment'],
  '🏦': ['bank', 'finance'],
  '🛒': ['cart', 'shop', 'grocery'],
  '🛍️': ['shopping', 'bags'],
  '💎': ['gem', 'value', 'premium'],
  '🎨': ['art', 'paint', 'creative'],
  '🖌️': ['brush', 'paint'],
  '📷': ['camera', 'photo'],
  '🎥': ['video', 'film', 'movie'],
  '🎵': ['music', 'note'],
  '🎸': ['guitar', 'music'],
  '🎤': ['mic', 'sing', 'podcast'],
  '🎧': ['headphones', 'music', 'audio'],
  '🎭': ['theater', 'drama'],
  '🏠': ['home', 'house'],
  '🏡': ['home', 'house'],
  '🛋️': ['couch', 'home', 'living'],
  '🚪': ['door'],
  '🛁': ['bath', 'home'],
  '🍽️': ['dining', 'eat', 'meal'],
  '🧹': ['clean', 'broom', 'chore'],
  '🪴': ['plant', 'home'],
  '🌱': ['plant', 'grow'],
  '🔧': ['wrench', 'fix', 'tool'],
  '✈️': ['plane', 'travel', 'flight'],
  '🛫': ['takeoff', 'travel'],
  '🚆': ['train', 'travel'],
  '🚗': ['car', 'drive', 'travel'],
  '🚲': ['bike', 'cycle'],
  '⛵': ['boat', 'sail'],
  '🏖️': ['beach', 'vacation'],
  '🏔️': ['mountain', 'hike'],
  '🏕️': ['camp', 'tent'],
  '🧳': ['luggage', 'travel'],
  '💻': ['laptop', 'code', 'computer', 'tech'],
  '🖥️': ['desktop', 'computer', 'monitor'],
  '⌨️': ['keyboard', 'type'],
  '📱': ['phone', 'mobile'],
  '🤖': ['robot', 'ai', 'bot'],
  '⚙️': ['settings', 'gear', 'config'],
  '🛠️': ['tools', 'build', 'fix'],
  '📡': ['antenna', 'signal', 'network'],
  '🎮': ['game', 'controller', 'gaming'],
  '🧩': ['puzzle', 'piece'],
};
