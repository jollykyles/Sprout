// questions.js — built-in fallback bank (grouped by grade band) used when AI is
// off or unavailable. Larger pool + anti-repeat so fallback questions vary.
// Each: { q, choices:[..], answer:<index of correct>, subject }

const QUESTION_BANK = {
  K: [
    { q: "Which one is bigger?", choices: ["🐜 an ant", "🐘 an elephant"], answer: 1, subject: "logic" },
    { q: "What comes after 2?", choices: ["3", "1", "5"], answer: 0, subject: "math" },
    { q: "How many legs does a dog have?", choices: ["2", "4", "6"], answer: 1, subject: "science" },
    { q: "Which shape is round?", choices: ["🔺 triangle", "⚪ circle", "⬛ square"], answer: 1, subject: "math" },
    { q: "What color is the sky on a sunny day?", choices: ["Blue", "Green", "Purple"], answer: 0, subject: "science" },
    { q: "Which word starts with the letter B?", choices: ["Cat", "Ball", "Sun"], answer: 1, subject: "reading" },
    { q: "1 + 1 = ?", choices: ["2", "3", "1"], answer: 0, subject: "math" },
    { q: "Which one can fly?", choices: ["🐟 fish", "🐦 bird", "🐢 turtle"], answer: 1, subject: "science" },
    { q: "What comes after 4?", choices: ["5", "3", "6"], answer: 0, subject: "math" },
    { q: "Which animal is the biggest?", choices: ["🐭 mouse", "🐴 horse", "🐤 chick"], answer: 1, subject: "science" },
    { q: "How many eyes do you have?", choices: ["1", "2", "3"], answer: 1, subject: "science" },
    { q: "Which one is a color?", choices: ["Red", "Chair", "Run"], answer: 0, subject: "reading" },
    { q: "2 + 1 = ?", choices: ["3", "2", "4"], answer: 0, subject: "math" },
    { q: "What do we use to see?", choices: ["Ears", "Eyes", "Feet"], answer: 1, subject: "science" },
    { q: "Which is warm?", choices: ["🔥 fire", "🧊 ice", "❄️ snow"], answer: 0, subject: "science" },
    { q: "Which letter comes after A?", choices: ["B", "D", "Z"], answer: 0, subject: "reading" },
    { q: "How many wheels does a bicycle have?", choices: ["2", "4", "3"], answer: 0, subject: "math" },
    { q: "Which one do you drink?", choices: ["Water", "Rock", "Book"], answer: 0, subject: "logic" },
    { q: "What comes next: 🔴 🔵 🔴 🔵 __ ?", choices: ["🔵", "🔴", "🟢"], answer: 1, subject: "puzzle" }
  ],
  "1": [
    { q: "5 + 3 = ?", choices: ["7", "8", "9"], answer: 1, subject: "math" },
    { q: "Which is the vowel?", choices: ["B", "E", "T"], answer: 1, subject: "reading" },
    { q: "10 - 4 = ?", choices: ["6", "5", "7"], answer: 0, subject: "math" },
    { q: "What season comes after winter?", choices: ["Summer", "Spring", "Fall"], answer: 1, subject: "science" },
    { q: "Which animal says 'moo'?", choices: ["Cow", "Duck", "Cat"], answer: 0, subject: "science" },
    { q: "How many days are in a week?", choices: ["5", "7", "10"], answer: 1, subject: "math" },
    { q: "Which word rhymes with 'cat'?", choices: ["Dog", "Hat", "Sun"], answer: 1, subject: "reading" },
    { q: "2 + 2 + 2 = ?", choices: ["4", "6", "8"], answer: 1, subject: "math" },
    { q: "7 + 2 = ?", choices: ["9", "8", "10"], answer: 0, subject: "math" },
    { q: "Which is bigger, 8 or 5?", choices: ["8", "5", "same"], answer: 0, subject: "math" },
    { q: "How many legs does a spider have?", choices: ["6", "8", "4"], answer: 1, subject: "science" },
    { q: "Which word means the opposite of 'hot'?", choices: ["Warm", "Cold", "Big"], answer: 1, subject: "reading" },
    { q: "9 - 3 = ?", choices: ["6", "5", "7"], answer: 0, subject: "math" },
    { q: "Where do fish live?", choices: ["In water", "In trees", "In the sky"], answer: 0, subject: "science" },
    { q: "Which comes first in the alphabet?", choices: ["M", "C", "T"], answer: 1, subject: "reading" },
    { q: "How many months are in a year?", choices: ["10", "12", "7"], answer: 1, subject: "math" },
    { q: "What do bees make?", choices: ["Honey", "Milk", "Bread"], answer: 0, subject: "science" },
    { q: "6 + 4 = ?", choices: ["10", "9", "11"], answer: 0, subject: "math" },
    { q: "What comes next: 1, 2, 3, __ ?", choices: ["5", "4", "6"], answer: 1, subject: "puzzle" }
  ],
  "2": [
    { q: "6 × 2 = ?", choices: ["12", "8", "10"], answer: 0, subject: "math" },
    { q: "Which is a mammal?", choices: ["Frog", "Whale", "Snake"], answer: 1, subject: "science" },
    { q: "What is the past tense of 'run'?", choices: ["Runned", "Ran", "Running"], answer: 1, subject: "reading" },
    { q: "20 + 15 = ?", choices: ["25", "35", "30"], answer: 1, subject: "math" },
    { q: "How many sides does a triangle have?", choices: ["3", "4", "5"], answer: 0, subject: "math" },
    { q: "Which planet do we live on?", choices: ["Mars", "Earth", "Jupiter"], answer: 1, subject: "science" },
    { q: "What do plants need to grow?", choices: ["Sunlight", "Candy", "Darkness"], answer: 0, subject: "science" },
    { q: "50 - 20 = ?", choices: ["20", "30", "40"], answer: 1, subject: "math" },
    { q: "5 × 2 = ?", choices: ["10", "7", "12"], answer: 0, subject: "math" },
    { q: "How many sides does a square have?", choices: ["3", "4", "5"], answer: 1, subject: "math" },
    { q: "Which is a plural word?", choices: ["Dog", "Dogs", "Dogged"], answer: 1, subject: "reading" },
    { q: "What do we call frozen water?", choices: ["Steam", "Ice", "Rain"], answer: 1, subject: "science" },
    { q: "3 × 3 = ?", choices: ["6", "9", "12"], answer: 1, subject: "math" },
    { q: "How many legs does an insect have?", choices: ["6", "8", "4"], answer: 0, subject: "science" },
    { q: "Which word is a question word?", choices: ["Jump", "Why", "Blue"], answer: 1, subject: "reading" },
    { q: "100 - 50 = ?", choices: ["40", "50", "60"], answer: 1, subject: "math" },
    { q: "What is baby frog called?", choices: ["Tadpole", "Puppy", "Cub"], answer: 0, subject: "science" },
    { q: "4 × 2 = ?", choices: ["6", "8", "10"], answer: 1, subject: "math" },
    { q: "What comes next: 2, 4, 6, __ ?", choices: ["7", "8", "9"], answer: 1, subject: "puzzle" }
  ],
  "3": [
    { q: "7 × 6 = ?", choices: ["42", "36", "48"], answer: 0, subject: "math" },
    { q: "Which word is a noun?", choices: ["Quickly", "River", "Jump"], answer: 1, subject: "reading" },
    { q: "What is 1/2 of 10?", choices: ["4", "5", "6"], answer: 1, subject: "math" },
    { q: "Which gas do we breathe in to live?", choices: ["Oxygen", "Helium", "Carbon dioxide"], answer: 0, subject: "science" },
    { q: "How many minutes are in an hour?", choices: ["30", "60", "100"], answer: 1, subject: "math" },
    { q: "What is the largest ocean?", choices: ["Atlantic", "Pacific", "Indian"], answer: 1, subject: "geography" },
    { q: "9 × 3 = ?", choices: ["27", "24", "18"], answer: 0, subject: "math" },
    { q: "Which one is a synonym for 'happy'?", choices: ["Sad", "Joyful", "Angry"], answer: 1, subject: "reading" },
    { q: "8 × 4 = ?", choices: ["32", "24", "28"], answer: 0, subject: "math" },
    { q: "How many legs do two dogs have together?", choices: ["6", "8", "4"], answer: 1, subject: "math" },
    { q: "Which is a verb?", choices: ["Table", "Swim", "Green"], answer: 1, subject: "reading" },
    { q: "What do we call animals that eat only plants?", choices: ["Herbivores", "Carnivores", "Robots"], answer: 0, subject: "science" },
    { q: "What is 1/4 of 8?", choices: ["2", "4", "3"], answer: 0, subject: "math" },
    { q: "Which planet is closest to the Sun?", choices: ["Mercury", "Earth", "Saturn"], answer: 0, subject: "science" },
    { q: "How many centimeters are in a meter?", choices: ["10", "100", "1000"], answer: 1, subject: "math" },
    { q: "Which word is spelled correctly?", choices: ["Freind", "Friend", "Frend"], answer: 1, subject: "reading" },
    { q: "12 ÷ 3 = ?", choices: ["3", "4", "6"], answer: 1, subject: "math" },
    { q: "What do plants give off that we breathe?", choices: ["Oxygen", "Smoke", "Sugar"], answer: 0, subject: "science" },
    { q: "What comes next: 5, 10, 15, __ ?", choices: ["18", "20", "25"], answer: 1, subject: "puzzle" }
  ],
  "4": [
    { q: "12 × 8 = ?", choices: ["96", "88", "104"], answer: 0, subject: "math" },
    { q: "What is the capital of the United States?", choices: ["New York", "Washington, D.C.", "Los Angeles"], answer: 1, subject: "geography" },
    { q: "3/4 as a decimal is…", choices: ["0.34", "0.75", "0.5"], answer: 1, subject: "math" },
    { q: "Which water cycle step forms clouds?", choices: ["Evaporation", "Condensation", "Collection"], answer: 1, subject: "science" },
    { q: "144 ÷ 12 = ?", choices: ["11", "12", "14"], answer: 1, subject: "math" },
    { q: "Which word is an adjective in: 'the bright star'?", choices: ["Star", "The", "Bright"], answer: 2, subject: "reading" },
    { q: "How many continents are there?", choices: ["5", "7", "9"], answer: 1, subject: "geography" },
    { q: "What is 25% of 80?", choices: ["20", "25", "15"], answer: 0, subject: "math" },
    { q: "7 × 9 = ?", choices: ["63", "56", "72"], answer: 0, subject: "math" },
    { q: "Which is a prime number?", choices: ["8", "11", "15"], answer: 1, subject: "math" },
    { q: "What is the freezing point of water in °C?", choices: ["0", "32", "100"], answer: 0, subject: "science" },
    { q: "Which word is an adverb?", choices: ["Slowly", "House", "Bright"], answer: 0, subject: "reading" },
    { q: "1/2 + 1/4 = ?", choices: ["3/4", "1/6", "2/6"], answer: 0, subject: "math" },
    { q: "What is the largest planet?", choices: ["Earth", "Jupiter", "Mars"], answer: 1, subject: "science" },
    { q: "Which country is shaped like a boot?", choices: ["Italy", "France", "Spain"], answer: 0, subject: "geography" },
    { q: "6 × 12 = ?", choices: ["72", "66", "84"], answer: 0, subject: "math" },
    { q: "How many sides does a hexagon have?", choices: ["5", "6", "8"], answer: 1, subject: "math" },
    { q: "What force pulls objects toward Earth?", choices: ["Gravity", "Friction", "Magnetism"], answer: 0, subject: "science" },
    { q: "If all Bloops are red and this is a Bloop, what color is it?", choices: ["Blue", "Red", "Green"], answer: 1, subject: "puzzle" }
  ],
  "5": [
    { q: "15 × 15 = ?", choices: ["215", "225", "205"], answer: 1, subject: "math" },
    { q: "Which is a prime number?", choices: ["9", "15", "17"], answer: 2, subject: "math" },
    { q: "What is the powerhouse of the cell?", choices: ["Nucleus", "Mitochondria", "Ribosome"], answer: 1, subject: "science" },
    { q: "2.5 + 3.75 = ?", choices: ["6.25", "5.25", "6.5"], answer: 0, subject: "math" },
    { q: "Which word is a verb in: 'she quietly reads'?", choices: ["Quietly", "Reads", "She"], answer: 1, subject: "reading" },
    { q: "Who was the first U.S. president?", choices: ["Abraham Lincoln", "George Washington", "Thomas Jefferson"], answer: 1, subject: "history" },
    { q: "What is the area of a 6 × 4 rectangle?", choices: ["10", "24", "20"], answer: 1, subject: "math" },
    { q: "Which state of matter has no fixed shape or volume?", choices: ["Solid", "Liquid", "Gas"], answer: 2, subject: "science" },
    { q: "What is 3/5 as a decimal?", choices: ["0.6", "0.35", "0.53"], answer: 0, subject: "math" },
    { q: "Which planet is known as the Red Planet?", choices: ["Venus", "Mars", "Neptune"], answer: 1, subject: "science" },
    { q: "144 ÷ 12 × 2 = ?", choices: ["24", "12", "18"], answer: 0, subject: "math" },
    { q: "Which is a synonym for 'enormous'?", choices: ["Tiny", "Huge", "Fast"], answer: 1, subject: "reading" },
    { q: "How many degrees are in a right angle?", choices: ["45", "90", "180"], answer: 1, subject: "math" },
    { q: "What gas do plants take in for photosynthesis?", choices: ["Oxygen", "Carbon dioxide", "Nitrogen"], answer: 1, subject: "science" },
    { q: "In which continent is Egypt?", choices: ["Asia", "Africa", "Europe"], answer: 1, subject: "geography" },
    { q: "What is 40% of 200?", choices: ["60", "80", "100"], answer: 1, subject: "math" },
    { q: "Which ocean is the largest?", choices: ["Atlantic", "Pacific", "Arctic"], answer: 1, subject: "geography" },
    { q: "What do we call a word that describes a noun?", choices: ["Verb", "Adjective", "Adverb"], answer: 1, subject: "reading" },
    { q: "What number is missing: 3, 6, __, 12, 15?", choices: ["8", "9", "10"], answer: 1, subject: "puzzle" }
  ]
};

// Pick a random question for a grade, avoiding recently-shown ones when possible.
function pickBankQuestion(grade, subjects, recent) {
  let list = (QUESTION_BANK[grade] || QUESTION_BANK["2"]).filter(
    (item) => !subjects || subjects.length === 0 || subjects.includes(item.subject)
  );
  if (!list.length) list = QUESTION_BANK[grade] || QUESTION_BANK["2"];
  let pool = list;
  if (recent && recent.length) {
    const avoid = new Set(recent);
    const filtered = list.filter((item) => !avoid.has(item.q));
    if (filtered.length) pool = filtered; // only skip recents if something's left
  }
  return pool[Math.floor(Math.random() * pool.length)];
}
