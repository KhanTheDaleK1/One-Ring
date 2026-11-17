import React, { useMemo, useState } from "react";
import {
  BookOpen,
  Search,
  X,
  Plus,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  FileText,
  Check,
  Trash2,
} from "lucide-react";
import type { SlideCue } from "../types";

export type BibleTranslation = "NIV" | "ESV" | "KJV" | "NLT";

export interface BibleLookupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddSlides: (title: string, slides: SlideCue[]) => void;
}

interface VerseEntry {
  verse: number;
  text: Record<BibleTranslation, string>;
}

interface ScripturePassage {
  id: string;
  book: string;
  aliases: string[];
  chapter: number;
  title: string;
  category: "Gospel" | "Psalms" | "Epistles" | "Old Testament" | "Great Commission";
  verses: VerseEntry[];
}

const TRANSLATIONS: { id: BibleTranslation; name: string }[] = [
  { id: "NIV", name: "New International Version" },
  { id: "ESV", name: "English Standard Version" },
  { id: "KJV", name: "King James Version" },
  { id: "NLT", name: "New Living Translation" },
];

const SCRIPTURE_DATASET: ScripturePassage[] = [
  {
    id: "john-3",
    book: "John",
    aliases: ["jn", "jhn"],
    chapter: 3,
    title: "John 3:16-17",
    category: "Gospel",
    verses: [
      {
        verse: 16,
        text: {
          NIV: "For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.",
          ESV: "For God so loved the world, that he gave his only Son, that whoever believes in him should not perish but have eternal life.",
          KJV: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.",
          NLT: "For this is how God loved the world: He gave his one and only Son, so that everyone who believes in him will not perish but have eternal life.",
        },
      },
      {
        verse: 17,
        text: {
          NIV: "For God did not send his Son into the world to condemn the world, but to save the world through him.",
          ESV: "For God did not send his Son into the world to condemn the world, but in order that the world might be saved through him.",
          KJV: "For God sent not his Son into the world to condemn the world; but that the world through him might be saved.",
          NLT: "God sent his Son into the world not to judge the world, but to save the world through him.",
        },
      },
    ],
  },
  {
    id: "psalm-23",
    book: "Psalm",
    aliases: ["psalms", "ps", "psa"],
    chapter: 23,
    title: "Psalm 23:1-6",
    category: "Psalms",
    verses: [
      {
        verse: 1,
        text: {
          NIV: "The LORD is my shepherd, I lack nothing.",
          ESV: "The LORD is my shepherd; I shall not want.",
          KJV: "The LORD is my shepherd; I shall not want.",
          NLT: "The LORD is my shepherd; I have all that I need.",
        },
      },
      {
        verse: 2,
        text: {
          NIV: "He makes me lie down in green pastures, he leads me beside quiet waters,",
          ESV: "He makes me lie down in green pastures. He leads me beside still waters.",
          KJV: "He maketh me to lie down in green pastures: he leadeth me beside the still waters.",
          NLT: "He lets me rest in green meadows; he leads me beside peaceful streams.",
        },
      },
      {
        verse: 3,
        text: {
          NIV: "he refreshes my soul. He guides me along the right paths for his name's sake.",
          ESV: "He restores my soul. He leads me in paths of righteousness for his name's sake.",
          KJV: "He restoreth my soul: he leadeth me in the paths of righteousness for his name's sake.",
          NLT: "He renews my strength. He guides me along right paths, bringing honor to his name.",
        },
      },
      {
        verse: 4,
        text: {
          NIV: "Even though I walk through the darkest valley, I will fear no evil, for you are with me; your rod and your staff, they comfort me.",
          ESV: "Even though I walk through the valley of the shadow of death, I will fear no evil, for you are with me; your rod and your staff, they comfort me.",
          KJV: "Yea, though I walk through the valley of the shadow of death, I will fear no evil: for thou art with me; thy rod and thy staff they comfort me.",
          NLT: "Even when I walk through the darkest valley, I will not be afraid, for you are close beside me. Your rod and your staff protect and comfort me.",
        },
      },
      {
        verse: 5,
        text: {
          NIV: "You prepare a table before me in the presence of my enemies. You anoint my head with oil; my cup overflows.",
          ESV: "You prepare a table before me in the presence of my enemies; you anoint my head with oil; my cup overflows.",
          KJV: "Thou preparest a table before me in the presence of mine enemies: thou anointest my head with oil; my cup runneth over.",
          NLT: "You prepare a feast for me in the presence of my enemies. You honor me by anointing my head with oil. My cup overflows with blessings.",
        },
      },
      {
        verse: 6,
        text: {
          NIV: "Surely your goodness and love will follow me all the days of my life, and I will dwell in the house of the LORD forever.",
          ESV: "Surely goodness and mercy shall follow me all the days of my life, and I shall dwell in the house of the LORD forever.",
          KJV: "Surely goodness and mercy shall follow me all the days of my life: and I will dwell in the house of the LORD for ever.",
          NLT: "Surely your goodness and unfailing love will pursue me all the days of my life, and I will live in the house of the LORD forever.",
        },
      },
    ],
  },
  {
    id: "romans-8",
    book: "Romans",
    aliases: ["rom", "ro"],
    chapter: 8,
    title: "Romans 8:28-31",
    category: "Epistles",
    verses: [
      {
        verse: 28,
        text: {
          NIV: "And we know that in all things God works for the good of those who love him, who have been called according to his purpose.",
          ESV: "And we know that for those who love God all things work together for good, for those who are called according to his purpose.",
          KJV: "And we know that all things work together for good to them that love God, to them who are the called according to his purpose.",
          NLT: "And we know that God causes everything to work together for the good of those who love God and are called according to his purpose for them.",
        },
      },
      {
        verse: 29,
        text: {
          NIV: "For those God foreknew he also predestined to be conformed to the image of his Son, that he might be the firstborn among many brothers and sisters.",
          ESV: "For those whom he foreknew he also predestined to be conformed to the image of his Son, in order that he might be the firstborn among many brothers.",
          KJV: "For whom he did foreknow, he also did predestinate to be conformed to the image of his Son, that he might be the firstborn among many brethren.",
          NLT: "For God knew his people in advance, and he chose them to become like his Son, so that his Son would be the firstborn among many brothers and sisters.",
        },
      },
      {
        verse: 30,
        text: {
          NIV: "And those he predestined, he also called; those he called, he also justified; those he justified, he also glorified.",
          ESV: "And those whom he predestined he also called, and those whom he called he also justified, and those whom he justified he also glorified.",
          KJV: "Moreover whom he did predestinate, them he also called: and whom he called, them he also justified: and whom he justified, them he also glorified.",
          NLT: "And having chosen them, he called them to come to him. And having called them, he gave them right standing with himself. And having given them right standing, he gave them his glory.",
        },
      },
      {
        verse: 31,
        text: {
          NIV: "What, then, shall we say in response to these things? If God is for us, who can be against us?",
          ESV: "What then shall we say to these things? If God is for us, who can be against us?",
          KJV: "What shall we then say to these things? If God be for us, who can be against us?",
          NLT: "What shall we say about such wonderful things as these? If God is for us, who can ever be against us?",
        },
      },
    ],
  },
  {
    id: "philippians-4",
    book: "Philippians",
    aliases: ["phil", "php"],
    chapter: 4,
    title: "Philippians 4:6-7, 13",
    category: "Epistles",
    verses: [
      {
        verse: 6,
        text: {
          NIV: "Do not be anxious about anything, but in every situation, by prayer and petition, with thanksgiving, present your requests to God.",
          ESV: "Do not be anxious about anything, but in everything by prayer and supplication with thanksgiving let your requests be made known to God.",
          KJV: "Be careful for nothing; but in every thing by prayer and supplication with thanksgiving let your requests be made known unto God.",
          NLT: "Don't worry about anything; instead, pray about everything. Tell God what you need, and thank him for all he has done.",
        },
      },
      {
        verse: 7,
        text: {
          NIV: "And the peace of God, which transcends all understanding, will guard your hearts and your minds in Christ Jesus.",
          ESV: "And the peace of God, which surpasses all understanding, will guard your hearts and your minds in Christ Jesus.",
          KJV: "And the peace of God, which passeth all understanding, shall keep your hearts and minds through Christ Jesus.",
          NLT: "Then you will experience God's peace, which exceeds anything we can understand. His peace will guard your hearts and minds as you live in Christ Jesus.",
        },
      },
      {
        verse: 13,
        text: {
          NIV: "I can do all this through him who gives me strength.",
          ESV: "I can do all things through him who strengthens me.",
          KJV: "I can do all things through Christ which strengtheneth me.",
          NLT: "For I can do everything through Christ, who gives me strength.",
        },
      },
    ],
  },
  {
    id: "genesis-1",
    book: "Genesis",
    aliases: ["gen", "gn"],
    chapter: 1,
    title: "Genesis 1:1-5",
    category: "Old Testament",
    verses: [
      {
        verse: 1,
        text: {
          NIV: "In the beginning God created the heavens and the earth.",
          ESV: "In the beginning, God created the heavens and the earth.",
          KJV: "In the beginning God created the heaven and the earth.",
          NLT: "In the beginning God created the heavens and the earth.",
        },
      },
      {
        verse: 2,
        text: {
          NIV: "Now the earth was formless and empty, darkness was over the surface of the deep, and the Spirit of God was hovering over the waters.",
          ESV: "The earth was without form and void, and darkness was over the face of the deep. And the Spirit of God was hovering over the face of the waters.",
          KJV: "And the earth was without form, and void; and darkness was upon the face of the deep. And the Spirit of God moved upon the face of the waters.",
          NLT: "The earth was formless and empty, and darkness covered the deep waters. And the Spirit of God was hovering over the surface of the waters.",
        },
      },
      {
        verse: 3,
        text: {
          NIV: "And God said, 'Let there be light,' and there was light.",
          ESV: "And God said, 'Let there be light,' and there was light.",
          KJV: "And God said, Let there be light: and there was light.",
          NLT: "Then God said, 'Let there be light,' and there was light.",
        },
      },
      {
        verse: 4,
        text: {
          NIV: "God saw that the light was good, and he separated the light from the darkness.",
          ESV: "And God saw that the light was good. And God separated the light from the darkness.",
          KJV: "And God saw the light, that it was good: and God divided the light from the darkness.",
          NLT: "And God saw that the light was good. Then he separated the light from the darkness.",
        },
      },
      {
        verse: 5,
        text: {
          NIV: "God called the light 'day,' and the darkness he called 'night.' And there was evening, and there was morning—the first day.",
          ESV: "God called the light Day, and the darkness he called Night. And there was evening and there was morning, the first day.",
          KJV: "And God called the light Day, and the darkness he called Night. And the evening and the morning were the first day.",
          NLT: "God called the light 'day' and the darkness 'night.' And evening passed and morning came, marking the first day.",
        },
      },
    ],
  },
  {
    id: "isaiah-40",
    book: "Isaiah",
    aliases: ["isa", "is"],
    chapter: 40,
    title: "Isaiah 40:28-31",
    category: "Old Testament",
    verses: [
      {
        verse: 28,
        text: {
          NIV: "Do you not know? Have you not heard? The LORD is the everlasting God, the Creator of the ends of the earth. He will not grow tired or weary, and his understanding no one can fathom.",
          ESV: "Have you not known? Have you not heard? The LORD is the everlasting God, the Creator of the ends of the earth. He does not faint or grow weary; his understanding is unsearchable.",
          KJV: "Hast thou not known? hast thou not heard, that the everlasting God, the LORD, the Creator of the ends of the earth, fainteth not, neither is weary? there is no searching of his understanding.",
          NLT: "Have you never heard? Have you never understood? The LORD is the everlasting God, the Creator of all the earth. He never grows weak or weary. No one can measure the depths of his understanding.",
        },
      },
      {
        verse: 29,
        text: {
          NIV: "He gives strength to the weary and increases the power of the weak.",
          ESV: "He gives power to the faint, and to him who has no might he increases strength.",
          KJV: "He giveth power to the faint; and to them that have no might he increaseth strength.",
          NLT: "He gives power to the weak and strength to the powerless.",
        },
      },
      {
        verse: 30,
        text: {
          NIV: "Even youths grow tired and weary, and young men stumble and fall;",
          ESV: "Even youths shall faint and be weary, and young men shall fall exhausted;",
          KJV: "Even the youths shall faint and be weary, and the young men shall utterly fall:",
          NLT: "Even youths will become weak and tired, and young men will fall in exhaustion.",
        },
      },
      {
        verse: 31,
        text: {
          NIV: "but those who hope in the LORD will renew their strength. They will soar on wings like eagles; they will run and not grow weary, they will walk and not be faint.",
          ESV: "but they who wait for the LORD shall renew their strength; they shall mount up with wings like eagles; they shall run and not be weary; they shall walk and not faint.",
          KJV: "But they that wait upon the LORD shall renew their strength; they shall mount up with wings as eagles; they shall run, and not be weary; and they shall walk, and not faint.",
          NLT: "But those who trust in the LORD will find new strength. They will soar high on wings like eagles. They will run and not grow weary. They will walk and not faint.",
        },
      },
    ],
  },
  {
    id: "1-corinthians-13",
    book: "1 Corinthians",
    aliases: ["1 cor", "1cor", "1co", "i corinthians"],
    chapter: 13,
    title: "1 Corinthians 13:1-8, 13",
    category: "Epistles",
    verses: [
      {
        verse: 1,
        text: {
          NIV: "If I speak in the tongues of men or of angels, but do not have love, I am only a resounding gong or a clanging cymbal.",
          ESV: "If I speak in the tongues of men and of angels, but have not love, I am a noisy gong or a clanging cymbal.",
          KJV: "Though I speak with the tongues of men and of angels, and have not charity, I am become as sounding brass, or a tinkling cymbal.",
          NLT: "If I could speak all the languages of earth and of angels, but didn't love others, I would only be a noisy gong or a clanging cymbal.",
        },
      },
      {
        verse: 2,
        text: {
          NIV: "If I have the gift of prophecy and can fathom all mysteries and all knowledge, and if I have a faith that can move mountains, but do not have love, I am nothing.",
          ESV: "And if I have prophetic powers, and understand all mysteries and all knowledge, and if I have all faith, so as to remove mountains, but have not love, I am nothing.",
          KJV: "And though I have the gift of prophecy, and understand all mysteries, and all knowledge; and though I have all faith, so that I could remove mountains, and have not charity, I am nothing.",
          NLT: "If I had the gift of prophecy, and if I understood all of God's secret plans and possessed all knowledge, and if I had such faith that I could move mountains, but didn't love others, I would be nothing.",
        },
      },
      {
        verse: 3,
        text: {
          NIV: "If I give all I possess to the poor and give over my body to hardship that I may boast, but do not have love, I gain nothing.",
          ESV: "If I give away all I have, and if I deliver up my body to be burned, but have not love, I gain nothing.",
          KJV: "And though I bestow all my goods to feed the poor, and though I give my body to be burned, and have not charity, it profiteth me nothing.",
          NLT: "If I gave everything I have to the poor and even sacrificed my body, I could boast about it; but if I didn't love others, I would have gained nothing.",
        },
      },
      {
        verse: 4,
        text: {
          NIV: "Love is patient, love is kind. It does not envy, it does not boast, it is not proud.",
          ESV: "Love is patient and kind; love does not envy or boast; it is not arrogant",
          KJV: "Charity suffereth long, and is kind; charity envieth not; charity vaunteth not itself, is not puffed up,",
          NLT: "Love is patient and kind. Love is not jealous or boastful or proud",
        },
      },
      {
        verse: 5,
        text: {
          NIV: "It does not dishonor others, it is not self-seeking, it is not easily angered, it keeps no record of wrongs.",
          ESV: "or rude. It does not insist on its own way; it is not irritable or resentful;",
          KJV: "Doth not behave itself unseemly, seeketh not her own, is not easily provoked, thinketh no evil;",
          NLT: "or rude. It does not demand its own way. It is not irritable, and it keeps no record of being wronged.",
        },
      },
      {
        verse: 6,
        text: {
          NIV: "Love does not delight in evil but rejoices with the truth.",
          ESV: "it does not rejoice at wrongdoing, but rejoices with the truth.",
          KJV: "Rejoiceth not in iniquity, but rejoiceth in the truth;",
          NLT: "It does not rejoice about injustice but rejoices whenever the truth wins out.",
        },
      },
      {
        verse: 7,
        text: {
          NIV: "It always protects, always trusts, always hopes, always perseveres.",
          ESV: "Love bears all things, believes all things, hopes all things, endures all things.",
          KJV: "Beareth all things, believeth all things, hopeth all things, endureth all things.",
          NLT: "Love never gives up, never loses faith, is always hopeful, and endures through every circumstance.",
        },
      },
      {
        verse: 8,
        text: {
          NIV: "Love never fails. But where there are prophecies, they will cease; where there are tongues, they will be stilled; where there is knowledge, it will pass away.",
          ESV: "Love never ends. As for prophecies, they will pass away; as for tongues, they will cease; as for knowledge, it will pass away.",
          KJV: "Charity never faileth: but whether there be prophecies, they shall fail; whether there be tongues, they shall cease; whether there be knowledge, it shall vanish away.",
          NLT: "Prophecy and speaking in unknown languages and special knowledge will become useless. But love will last forever!",
        },
      },
      {
        verse: 13,
        text: {
          NIV: "And now these three remain: faith, hope and love. But the greatest of these is love.",
          ESV: "So now faith, hope, and love abide, these three; but the greatest of these is love.",
          KJV: "And now abideth faith, hope, charity, these three; but the greatest of these is charity.",
          NLT: "Three things will last forever—faith, hope, and love—and the greatest of these is love.",
        },
      },
    ],
  },
  {
    id: "matthew-28",
    book: "Matthew",
    aliases: ["matt", "mt"],
    chapter: 28,
    title: "Matthew 28:18-20",
    category: "Great Commission",
    verses: [
      {
        verse: 18,
        text: {
          NIV: "Then Jesus came to them and said, 'All authority in heaven and on earth has been given to me.",
          ESV: "And Jesus came and said to them, 'All authority in heaven and on earth has been given to me.",
          KJV: "And Jesus came and spake unto them, saying, All power is given unto me in heaven and in earth.",
          NLT: "Jesus came and told his disciples, 'I have been given all authority in heaven and on earth.",
        },
      },
      {
        verse: 19,
        text: {
          NIV: "Therefore go and make disciples of all nations, baptizing them in the name of the Father and of the Son and of the Holy Spirit,",
          ESV: "Go therefore and make disciples of all nations, baptizing them in the name of the Father and of the Son and of the Holy Spirit,",
          KJV: "Go ye therefore, and teach all nations, baptizing them in the name of the Father, and of the Son, and of the Holy Ghost:",
          NLT: "Therefore, go and make disciples of all the nations, baptizing them in the name of the Father and the Son and the Holy Spirit.",
        },
      },
      {
        verse: 20,
        text: {
          NIV: "and teaching them to obey everything I have commanded you. And surely I am with you always, to the very end of the age.'",
          ESV: "teaching them to observe all that I have commanded you. And behold, I am with you always, to the end of the age.'",
          KJV: "Teaching them to observe all things whatsoever I have commanded you: and, lo, I am with you always, even unto the end of the world. Amen.",
          NLT: "Teach these new disciples to obey all the commands I have given you. And be sure of this: I am with you always, even to the end of the age.'",
        },
      },
    ],
  },
  {
    id: "proverbs-3",
    book: "Proverbs",
    aliases: ["prov", "pr", "pro"],
    chapter: 3,
    title: "Proverbs 3:5-6",
    category: "Old Testament",
    verses: [
      {
        verse: 5,
        text: {
          NIV: "Trust in the LORD with all your heart and lean not on your own understanding;",
          ESV: "Trust in the LORD with all your heart, and do not lean on your own understanding.",
          KJV: "Trust in the LORD with all thine heart; and lean not unto thine own understanding.",
          NLT: "Trust in the LORD with all your heart; do not depend on your own understanding.",
        },
      },
      {
        verse: 6,
        text: {
          NIV: "in all your ways submit to him, and he will make your paths straight.",
          ESV: "In all your ways acknowledge him, and he will make straight your paths.",
          KJV: "In all thy ways acknowledge him, and he shall direct thy paths.",
          NLT: "Seek his will in all you do, and he will show you which path to take.",
        },
      },
    ],
  },
  {
    id: "jeremiah-29",
    book: "Jeremiah",
    aliases: ["jer", "je"],
    chapter: 29,
    title: "Jeremiah 29:11",
    category: "Old Testament",
    verses: [
      {
        verse: 11,
        text: {
          NIV: "'For I know the plans I have for you,' declares the LORD, 'plans to prosper you and not to harm you, plans to give you hope and a future.'",
          ESV: "'For I know the plans I have for you, declares the LORD, plans for welfare and not for evil, to give you a future and a hope.'",
          KJV: "'For I know the thoughts that I think toward you, saith the LORD, thoughts of peace, and not of evil, to give you an expected end.'",
          NLT: "'For I know the plans I have for you,' says the LORD. 'They are plans for good and not for disaster, to give you a future and a hope.'",
        },
      },
    ],
  },
  {
    id: "joshua-1",
    book: "Joshua",
    aliases: ["josh", "jos"],
    chapter: 1,
    title: "Joshua 1:9",
    category: "Old Testament",
    verses: [
      {
        verse: 9,
        text: {
          NIV: "Have I not commanded you? Be strong and courageous. Do not be afraid; do not be discouraged, for the LORD your God will be with you wherever you go.",
          ESV: "Have I not commanded you? Be strong and courageous. Do not be frightened, and do not be dismayed, for the LORD your God is with you wherever you go.",
          KJV: "Have not I commanded thee? Be strong and of a good courage; be not afraid, neither be thou dismayed: for the LORD thy God is with thee whithersoever thou goest.",
          NLT: "This is my command—be strong and courageous! Do not be afraid or discouraged. For the LORD your God is with you wherever you go.",
        },
      },
    ],
  },
  {
    id: "psalm-46",
    book: "Psalm",
    aliases: ["psalms", "ps", "psa"],
    chapter: 46,
    title: "Psalm 46:1-3, 10",
    category: "Psalms",
    verses: [
      {
        verse: 1,
        text: {
          NIV: "God is our refuge and strength, an ever-present help in trouble.",
          ESV: "God is our refuge and strength, a very present help in trouble.",
          KJV: "God is our refuge and strength, a very present help in trouble.",
          NLT: "God is our refuge and strength, always ready to help in times of trouble.",
        },
      },
      {
        verse: 2,
        text: {
          NIV: "Therefore we will not fear, though the earth give way and the mountains fall into the heart of the sea,",
          ESV: "Therefore we will not fear though the earth gives way, though the mountains be moved into the heart of the sea,",
          KJV: "Therefore will not we fear, though the earth be removed, and though the mountains be carried into the midst of the sea;",
          NLT: "So we will not fear when earthquakes come and the mountains crumble into the sea.",
        },
      },
      {
        verse: 3,
        text: {
          NIV: "though its waters roar and foam and the mountains quake with their surging.",
          ESV: "though its waters roar and foam, though the mountains tremble at its swelling.",
          KJV: "Though the waters thereof roar and be troubled, though the mountains shake with the swelling thereof.",
          NLT: "Let the oceans roar and foam. Let the mountains tremble as the waters surge!",
        },
      },
      {
        verse: 10,
        text: {
          NIV: "He says, 'Be still, and know that I am God; I will be exalted among the nations, I will be exalted in the earth.'",
          ESV: "'Be still, and know that I am God. I will be exalted among the nations, I will be exalted in the earth!'",
          KJV: "Be still, and know that I am God: I will be exalted among the heathen, I will be exalted in the earth.",
          NLT: "'Be still, and know that I am God! I will be honored by every nation. I will be honored throughout the world.'",
        },
      },
    ],
  },
  {
    id: "psalm-100",
    book: "Psalm",
    aliases: ["psalms", "ps", "psa"],
    chapter: 100,
    title: "Psalm 100:1-5",
    category: "Psalms",
    verses: [
      {
        verse: 1,
        text: {
          NIV: "Shout for joy to the LORD, all the earth.",
          ESV: "Make a joyful noise to the LORD, all the earth!",
          KJV: "Make a joyful noise unto the LORD, all ye lands.",
          NLT: "Shout with joy to the LORD, all the earth!",
        },
      },
      {
        verse: 2,
        text: {
          NIV: "Worship the LORD with gladness; come before him with joyful songs.",
          ESV: "Serve the LORD with gladness! Come into his presence with singing!",
          KJV: "Serve the LORD with gladness: come before his presence with singing.",
          NLT: "Worship the LORD with gladness. Come before him, singing with joy.",
        },
      },
      {
        verse: 3,
        text: {
          NIV: "Know that the LORD is God. It is he who made us, and we are his; we are his people, the sheep of his pasture.",
          ESV: "Know that the LORD, he is God! It is he who made us, and we are his; we are his people, and the sheep of his pasture.",
          KJV: "Know ye that the LORD he is God: it is he that hath made us, and not we ourselves; we are his people, and the sheep of his pasture.",
          NLT: "Acknowledge that the LORD is God! He made us, and we are his. We are his people, the sheep of his pasture.",
        },
      },
      {
        verse: 4,
        text: {
          NIV: "Enter his gates with thanksgiving and his courts with praise; give thanks to him and praise his name.",
          ESV: "Enter his gates with thanksgiving, and his courts with praise! Give thanks to him; bless his name!",
          KJV: "Enter into his gates with thanksgiving, and into his courts with praise: be thankful unto him, and bless his name.",
          NLT: "Enter his gates with thanksgiving; go into his courts with praise. Give thanks to him and praise his name.",
        },
      },
      {
        verse: 5,
        text: {
          NIV: "For the LORD is good and his love endures forever; his faithfulness continues through all generations.",
          ESV: "For the LORD is good; his steadfast love endures forever, and his faithfulness to all generations.",
          KJV: "For the LORD is good; his mercy is everlasting; and his truth endureth to all generations.",
          NLT: "For the LORD is good. His unfailing love continues forever, and his faithfulness continues to each generation.",
        },
      },
    ],
  },
  {
    id: "matthew-11",
    book: "Matthew",
    aliases: ["matt", "mt"],
    chapter: 11,
    title: "Matthew 11:28-30",
    category: "Gospel",
    verses: [
      {
        verse: 28,
        text: {
          NIV: "Come to me, all you who are weary and burdened, and I will give you rest.",
          ESV: "Come to me, all who labor and are heavy laden, and I will give you rest.",
          KJV: "Come unto me, all ye that labour and are heavy laden, and I will give you rest.",
          NLT: "Then Jesus said, 'Come to me, all of you who are weary and carry heavy burdens, and I will give you rest.'",
        },
      },
      {
        verse: 29,
        text: {
          NIV: "Take my yoke upon you and learn from me, for I am gentle and humble in heart, and you will find rest for your souls.",
          ESV: "Take my yoke upon you, and learn from me, for I am gentle and lowly in heart, and you will find rest for your souls.",
          KJV: "Take my yoke upon you, and learn of me; for I am meek and lowly in heart: and ye shall find rest unto your souls.",
          NLT: "Take my yoke upon you. Let me teach you, because I am humble and gentle at heart, and you will find rest for your souls.",
        },
      },
      {
        verse: 30,
        text: {
          NIV: "For my yoke is easy and my burden is light.",
          ESV: "For my yoke is easy, and my burden is light.",
          KJV: "For my yoke is easy, and my burden is light.",
          NLT: "For my yoke is easy to bear, and the burden I give you is light.",
        },
      },
    ],
  },
  {
    id: "romans-12",
    book: "Romans",
    aliases: ["rom", "ro"],
    chapter: 12,
    title: "Romans 12:1-2",
    category: "Epistles",
    verses: [
      {
        verse: 1,
        text: {
          NIV: "Therefore, I urge you, brothers and sisters, in view of God's mercy, to offer your bodies as a living sacrifice, holy and pleasing to God—this is your true and proper worship.",
          ESV: "I appeal to you therefore, brothers, by the mercies of God, to present your bodies as a living sacrifice, holy and acceptable to God, which is your spiritual worship.",
          KJV: "I beseech you therefore, brethren, by the mercies of God, that ye present your bodies a living sacrifice, holy, acceptable unto God, which is your reasonable service.",
          NLT: "And so, dear brothers and sisters, I plead with you to give your bodies to God because of all he has done for you. Let them be a living and holy sacrifice—the kind he will find acceptable. This is truly the way to worship him.",
        },
      },
      {
        verse: 2,
        text: {
          NIV: "Do not conform to the pattern of this world, but be transformed by the renewing of your mind. Then you will be able to test and approve what God's will is—his good, pleasing and perfect will.",
          ESV: "Do not be conformed to this world, but be transformed by the renewal of your mind, that by testing you may discern what is the will of God, what is good and acceptable and perfect.",
          KJV: "And be not conformed to this world: but be ye transformed by the renewing of your mind, that ye may prove what is that good, and acceptable, and perfect, will of God.",
          NLT: "Don't copy the behavior and customs of this world, but let God transform you into a new person by changing the way you think. Then you will learn to know God's will for you, which is good and pleasing and perfect.",
        },
      },
    ],
  },
  {
    id: "ephesians-2",
    book: "Ephesians",
    aliases: ["eph"],
    chapter: 2,
    title: "Ephesians 2:8-9",
    category: "Epistles",
    verses: [
      {
        verse: 8,
        text: {
          NIV: "For it is by grace you have been saved, through faith—and this is not from yourselves, it is the gift of God—",
          ESV: "For by grace you have been saved through faith. And this is not your own doing; it is the gift of God,",
          KJV: "For by grace are ye saved through faith; and that not of yourselves: it is the gift of God:",
          NLT: "God saved you by his grace when you believed. And you can't take credit for this; it is a gift from God.",
        },
      },
      {
        verse: 9,
        text: {
          NIV: "not by works, so that no one can boast.",
          ESV: "not a result of works, so that no one may boast.",
          KJV: "Not of works, lest any man should boast.",
          NLT: "Salvation is not a reward for the good things we have done, so none of us can boast about it.",
        },
      },
    ],
  },
  {
    id: "galatians-5",
    book: "Galatians",
    aliases: ["gal", "ga"],
    chapter: 5,
    title: "Galatians 5:22-23",
    category: "Epistles",
    verses: [
      {
        verse: 22,
        text: {
          NIV: "But the fruit of the Spirit is love, joy, peace, forbearance, kindness, goodness, faithfulness,",
          ESV: "But the fruit of the Spirit is love, joy, peace, patience, kindness, goodness, faithfulness,",
          KJV: "But the fruit of the Spirit is love, joy, peace, longsuffering, gentleness, goodness, faith,",
          NLT: "But the Holy Spirit produces this kind of fruit in our lives: love, joy, peace, patience, kindness, goodness, faithfulness,",
        },
      },
      {
        verse: 23,
        text: {
          NIV: "gentleness and self-control. Against such things there is no law.",
          ESV: "gentleness, self-control; against such things there is no law.",
          KJV: "Meekness, temperance: against such there is no law.",
          NLT: "gentleness, and self-control. There is no law against these things!",
        },
      },
    ],
  },
  {
    id: "hebrews-11",
    book: "Hebrews",
    aliases: ["heb"],
    chapter: 11,
    title: "Hebrews 11:1",
    category: "Epistles",
    verses: [
      {
        verse: 1,
        text: {
          NIV: "Now faith is confidence in what we hope for and assurance about what we do not see.",
          ESV: "Now faith is the assurance of things hoped for, the conviction of things not seen.",
          KJV: "Now faith is the substance of things hoped for, the evidence of things not seen.",
          NLT: "Faith shows the reality of what we hope for; it is the evidence of things we cannot see.",
        },
      },
    ],
  },
  {
    id: "2-chronicles-7",
    book: "2 Chronicles",
    aliases: ["2 chron", "2chr", "2ch"],
    chapter: 7,
    title: "2 Chronicles 7:14",
    category: "Old Testament",
    verses: [
      {
        verse: 14,
        text: {
          NIV: "if my people, who are called by my name, will humble themselves and pray and seek my face and turn from their wicked ways, then I will hear from heaven, and I will forgive their sin and will heal their land.",
          ESV: "if my people who are called by my name humble themselves, and pray and seek my face and turn from their wicked ways, then I will hear from heaven and will forgive their sin and heal their land.",
          KJV: "If my people, which are called by my name, shall humble themselves, and pray, and seek my face, and turn from their wicked ways; then will I hear from heaven, and will forgive their sin, and will heal their land.",
          NLT: "Then if my people who are called by my name will humble themselves and pray and seek my face and turn from their wicked ways, I will hear from heaven and will forgive their sins and restore their land.",
        },
      },
    ],
  },
];

const QUICK_REFS = [
  "John 3:16",
  "Psalm 23",
  "Romans 8:28",
  "Philippians 4:13",
  "Genesis 1:1",
  "Isaiah 40:31",
  "1 Corinthians 13",
  "Matthew 28:18-20",
  "Proverbs 3:5-6",
  "Jeremiah 29:11",
  "Psalm 46:1-10",
  "Psalm 100",
];

function wrapTextToLines(text: string, maxCharsPerLine = 52): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!word) continue;
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxCharsPerLine) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

interface ParsedVerse {
  verseNum?: number;
  text: string;
}

function parseRawBibleText(raw: string): ParsedVerse[] {
  const normalized = raw.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const superMap: Record<string, string> = {
    "⁰": "0",
    "¹": "1",
    "²": "2",
    "³": "3",
    "⁴": "4",
    "⁵": "5",
    "⁶": "6",
    "⁷": "7",
    "⁸": "8",
    "⁹": "9",
  };
  const asciiNormalized = normalized.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => superMap[c] || c);

  // Split inline or line-started verse numbers like "16 For God..." or "[16] ..." or "16. ..."
  const tokenRegex = /(?:^|\n|\s)(?:\[?(\d{1,3})\]?[.:)]?\s+)(?=[A-Za-z"'‘“])/g;
  const matches: { index: number; fullLen: number; num: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(asciiNormalized)) !== null) {
    const num = Number(match[1]);
    if (num >= 1 && num <= 176) {
      matches.push({ index: match.index, fullLen: match[0].length, num });
    }
  }

  if (matches.length >= 1) {
    const verses: ParsedVerse[] = [];
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index + matches[i].fullLen;
      const end = i + 1 < matches.length ? matches[i + 1].index : asciiNormalized.length;
      const text = asciiNormalized.slice(start, end).replace(/\s+/g, " ").trim();
      if (text) {
        verses.push({ verseNum: matches[i].num, text });
      }
    }
    if (verses.length > 0) return verses;
  }

  const lines = asciiNormalized
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length > 1) {
    return lines.map((line) => ({ text: line }));
  }

  const sentences = asciiNormalized.match(/[^.!?]+[.!?]+(?:\s|$)/g);
  if (sentences && sentences.length > 1) {
    return sentences.map((s) => ({ text: s.trim() }));
  }

  return [{ text: asciiNormalized }];
}

function buildScriptureSlides(
  verses: ParsedVerse[],
  baseReference: string,
  translation: BibleTranslation,
  options: {
    versesPerSlide: 1 | 2;
    maxLinesPerSlide: number;
    includeVerseNumbers: boolean;
    includeWatermark: boolean;
  }
): SlideCue[] {
  if (verses.length === 0) return [];

  const slides: SlideCue[] = [];
  let pendingTexts: string[] = [];
  let pendingVerseNums: number[] = [];
  let pendingLineCount = 0;

  const formatSlideRef = (nums: number[]): string => {
    const ref = baseReference.trim() || "Scripture";
    if (nums.length === 0) return `${ref} (${translation})`;
    const first = nums[0];
    const last = nums[nums.length - 1];
    if (/:\d+/.test(ref)) {
      const chapterPart = ref.split(":")[0];
      return first === last
        ? `${chapterPart}:${first} (${translation})`
        : `${chapterPart}:${first}-${last} (${translation})`;
    }
    return first === last
      ? `${ref}:${first} (${translation})`
      : `${ref}:${first}-${last} (${translation})`;
  };

  const flushPending = () => {
    if (pendingTexts.length === 0) return;
    const slideRef = formatSlideRef(pendingVerseNums);
    const body = pendingTexts.join("\n");
    const slideNum = slides.length + 1;
    slides.push({
      id: `scripture-${slideNum}-${pendingVerseNums.join("-") || "v"}`,
      number: slideNum,
      section: slideRef,
      title: `${slideRef} • Slide ${slideNum}`,
      text: options.includeWatermark ? `${body}\n— ${slideRef}` : body,
      kind: "scripture",
    });
    pendingTexts = [];
    pendingVerseNums = [];
    pendingLineCount = 0;
  };

  for (const v of verses) {
    const prefix =
      options.includeVerseNumbers && v.verseNum !== undefined ? `${v.verseNum} ` : "";
    const wrapped = wrapTextToLines(`${prefix}${v.text}`, 50);

    if (wrapped.length > options.maxLinesPerSlide) {
      flushPending();
      for (let i = 0; i < wrapped.length; i += options.maxLinesPerSlide) {
        const chunkLines = wrapped.slice(i, i + options.maxLinesPerSlide);
        const slideRef = formatSlideRef(v.verseNum !== undefined ? [v.verseNum] : []);
        const slideNum = slides.length + 1;
        const body = chunkLines.join("\n");
        slides.push({
          id: `scripture-${slideNum}-${v.verseNum ?? "p"}-${i}`,
          number: slideNum,
          section: slideRef,
          title: `${slideRef} • Slide ${slideNum}`,
          text: options.includeWatermark ? `${body}\n— ${slideRef}` : body,
          kind: "scripture",
        });
      }
      continue;
    }

    const wouldExceedVerses = pendingTexts.length >= options.versesPerSlide;
    const wouldExceedLines =
      pendingTexts.length > 0 && pendingLineCount + wrapped.length > options.maxLinesPerSlide;

    if (wouldExceedVerses || wouldExceedLines) {
      flushPending();
    }

    pendingTexts.push(wrapped.join("\n"));
    if (v.verseNum !== undefined) pendingVerseNums.push(v.verseNum);
    pendingLineCount += wrapped.length;
  }

  flushPending();
  return slides;
}

function normalizeBookName(input: string): string {
  return input.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
}

function resolveLookupQuery(
  rawQuery: string,
  translation: BibleTranslation
): {
  passage: ScripturePassage | null;
  matchedVerses: VerseEntry[];
  resolvedRef: string;
  suggestions: ScripturePassage[];
} {
  const q = rawQuery.trim();
  if (!q) {
    const fallback = SCRIPTURE_DATASET[0];
    return {
      passage: fallback,
      matchedVerses: fallback.verses,
      resolvedRef: `${fallback.book} ${fallback.chapter}`,
      suggestions: SCRIPTURE_DATASET,
    };
  }

  const refMatch = q.match(
    /^([1-3]?\s*[a-zA-Z]+(?:\s+[a-zA-Z]+)?)\s+(\d+)(?::(\d+)(?:\s*-\s*(\d+))?)?$/i
  );
  if (refMatch) {
    const bookQuery = normalizeBookName(refMatch[1]);
    const chapterNum = Number(refMatch[2]);
    const startVerse = refMatch[3] ? Number(refMatch[3]) : undefined;
    const endVerse = refMatch[4] ? Number(refMatch[4]) : startVerse;

    const found = SCRIPTURE_DATASET.find((p) => {
      if (p.chapter !== chapterNum) return false;
      const bNorm = normalizeBookName(p.book);
      if (bNorm === bookQuery || bNorm.startsWith(bookQuery)) return true;
      return p.aliases.some((a) => normalizeBookName(a) === bookQuery);
    });

    if (found) {
      let filtered = found.verses;
      if (startVerse !== undefined) {
        const rangeEnd = endVerse ?? startVerse;
        const slice = found.verses.filter(
          (v) => v.verse >= startVerse && v.verse <= rangeEnd
        );
        if (slice.length > 0) filtered = slice;
      }
      const refStr =
        startVerse !== undefined
          ? endVerse && endVerse !== startVerse
            ? `${found.book} ${found.chapter}:${startVerse}-${endVerse}`
            : `${found.book} ${found.chapter}:${startVerse}`
          : `${found.book} ${found.chapter}`;
      return {
        passage: found,
        matchedVerses: filtered,
        resolvedRef: refStr,
        suggestions: SCRIPTURE_DATASET,
      };
    }
  }

  const lower = normalizeBookName(q);
  const matchingPassages = SCRIPTURE_DATASET.filter((p) => {
    const hay = `${p.book} ${p.chapter} ${p.title} ${p.aliases.join(" ")}`.toLowerCase();
    if (hay.includes(lower)) return true;
    return p.verses.some((v) => v.text[translation].toLowerCase().includes(lower));
  });

  if (matchingPassages.length > 0) {
    const top = matchingPassages[0];
    return {
      passage: top,
      matchedVerses: top.verses,
      resolvedRef: `${top.book} ${top.chapter}`,
      suggestions: matchingPassages,
    };
  }

  return {
    passage: null,
    matchedVerses: [],
    resolvedRef: q,
    suggestions: [],
  };
}

export const BibleLookupModal: React.FC<BibleLookupModalProps> = ({
  isOpen,
  onClose,
  onAddSlides,
}) => {
  const [translation, setTranslation] = useState<BibleTranslation>("NIV");
  const [mode, setMode] = useState<"lookup" | "paste">("lookup");
  const [searchQuery, setSearchQuery] = useState("John 3:16");
  const [customRef, setCustomRef] = useState("Colossians 3:12-15");
  const [pastedText, setPastedText] = useState(
    "12 Therefore, as God's chosen people, holy and dearly loved, clothe yourselves with compassion, kindness, humility, gentleness and patience.\n13 Bear with each other and forgive one another if any of you has a grievance against someone. Forgive as the Lord forgave you.\n14 And over all these virtues put on love, which binds them all together in perfect unity.\n15 Let the peace of Christ rule in your hearts, since as members of one body you were called to peace. And be thankful."
  );
  const [manualVerseInput, setManualVerseInput] = useState("");
  const [manualVerseNum, setManualVerseNum] = useState("16");
  const [versesPerSlide, setVersesPerSlide] = useState<1 | 2>(2);
  const [maxLinesPerSlide, setMaxLinesPerSlide] = useState<number>(3);
  const [includeVerseNumbers, setIncludeVerseNumbers] = useState(true);
  const [includeWatermark, setIncludeWatermark] = useState(true);
  const [selectedPreviewIndex, setSelectedPreviewIndex] = useState(0);

  const lookupResult = useMemo(
    () => resolveLookupQuery(searchQuery, translation),
    [searchQuery, translation]
  );

  const generatedSlides = useMemo(() => {
    if (mode === "lookup") {
      if (!lookupResult.passage || lookupResult.matchedVerses.length === 0) return [];
      const parsed: ParsedVerse[] = lookupResult.matchedVerses.map((v) => ({
        verseNum: v.verse,
        text: v.text[translation],
      }));
      return buildScriptureSlides(parsed, lookupResult.resolvedRef, translation, {
        versesPerSlide,
        maxLinesPerSlide,
        includeVerseNumbers,
        includeWatermark,
      });
    }

    const parsed = parseRawBibleText(pastedText);
    return buildScriptureSlides(parsed, customRef || "Custom Scripture", translation, {
      versesPerSlide,
      maxLinesPerSlide,
      includeVerseNumbers,
      includeWatermark,
    });
  }, [
    mode,
    lookupResult,
    translation,
    pastedText,
    customRef,
    versesPerSlide,
    maxLinesPerSlide,
    includeVerseNumbers,
    includeWatermark,
  ]);

  if (!isOpen) return null;

  const safePreviewIndex =
    generatedSlides.length === 0
      ? 0
      : Math.min(selectedPreviewIndex, generatedSlides.length - 1);
  const activeSlide = generatedSlides[safePreviewIndex];

  const resolvedTitle =
    mode === "lookup"
      ? `${lookupResult.resolvedRef} (${translation})`
      : `${customRef.trim() || "Scripture"} (${translation})`;

  const handleSelectQuickRef = (ref: string) => {
    setMode("lookup");
    setSearchQuery(ref);
    setSelectedPreviewIndex(0);
  };

  const handleAppendManualVerse = () => {
    const txt = manualVerseInput.trim();
    if (!txt) return;
    const num = manualVerseNum.trim();
    const formattedLine = num ? `${num} ${txt}` : txt;
    setPastedText((prev) => (prev.trim() ? `${prev.trim()}\n${formattedLine}` : formattedLine));
    setManualVerseInput("");
    if (num && !Number.isNaN(Number(num))) {
      setManualVerseNum(String(Number(num) + 1));
    }
  };

  const handleAddToService = () => {
    if (generatedSlides.length === 0) return;
    onAddSlides(resolvedTitle, generatedSlides);
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(8, 11, 16, 0.85)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10001,
        padding: 20,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 1040,
          maxHeight: "88vh",
          background: "#121721",
          border: "1px solid #2E3748",
          borderRadius: 14,
          padding: 22,
          color: "#E2E8F0",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.7)",
          overflow: "hidden",
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 9,
                background: "rgba(245, 158, 11, 0.14)",
                border: "1px solid rgba(245, 158, 11, 0.38)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <BookOpen size={20} color="#FBBF24" />
            </div>
            <div style={{ minWidth: 0 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#FFFFFF" }}>
                Bible Lookup & Scripture Slide Engine
              </h3>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "#94A3B8" }}>
                ProPresenter / EasyWorship-style reference lookup, multi-verse reflow, and watermarked projection slides.
              </p>
            </div>
          </div>

          {/* Translation Selector Pills */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <div
              style={{
                display: "flex",
                background: "#0B0F17",
                border: "1px solid #252C38",
                borderRadius: 8,
                padding: 3,
                gap: 3,
              }}
            >
              {TRANSLATIONS.map((tr) => {
                const active = translation === tr.id;
                return (
                  <button
                    key={tr.id}
                    type="button"
                    title={tr.name}
                    onClick={() => {
                      setTranslation(tr.id);
                      setSelectedPreviewIndex(0);
                    }}
                    style={{
                      padding: "5px 10px",
                      borderRadius: 6,
                      border: "none",
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 800,
                      letterSpacing: "0.04em",
                      background: active ? "#D97706" : "transparent",
                      color: active ? "#FFFFFF" : "#94A3B8",
                    }}
                  >
                    {tr.id}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Bible lookup modal"
              style={{
                background: "transparent",
                border: "none",
                color: "#94A3B8",
                cursor: "pointer",
                padding: 4,
              }}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Mode Tabs & Slide Pacing Bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
            padding: "8px 12px",
            background: "#0D1117",
            border: "1px solid #1E2533",
            borderRadius: 10,
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              onClick={() => {
                setMode("lookup");
                setSelectedPreviewIndex(0);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                borderRadius: 7,
                border: `1px solid ${mode === "lookup" ? "#F59E0B" : "#283344"}`,
                background: mode === "lookup" ? "rgba(245, 158, 11, 0.16)" : "#161B24",
                color: mode === "lookup" ? "#FDE68A" : "#CBD5E1",
                fontSize: 12.5,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              <Search size={14} /> Reference Lookup
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("paste");
                setSelectedPreviewIndex(0);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                borderRadius: 7,
                border: `1px solid ${mode === "paste" ? "#3B82F6" : "#283344"}`,
                background: mode === "paste" ? "rgba(59, 130, 246, 0.18)" : "#161B24",
                color: mode === "paste" ? "#BFDBFE" : "#CBD5E1",
                fontSize: 12.5,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              <FileText size={14} /> Paste / Manual Builder
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#CBD5E1" }}>
              <span>Verses / Slide:</span>
              <select
                value={versesPerSlide}
                onChange={(e) => {
                  setVersesPerSlide(Number(e.target.value) as 1 | 2);
                  setSelectedPreviewIndex(0);
                }}
                style={compactSelectStyle}
              >
                <option value={1}>1 Verse</option>
                <option value={2}>2 Verses (Auto-Fit)</option>
              </select>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#CBD5E1" }}>
              <span>Max Lines:</span>
              <select
                value={maxLinesPerSlide}
                onChange={(e) => {
                  setMaxLinesPerSlide(Number(e.target.value));
                  setSelectedPreviewIndex(0);
                }}
                style={compactSelectStyle}
              >
                <option value={2}>2 Lines</option>
                <option value={3}>3 Lines</option>
                <option value={4}>4 Lines</option>
              </select>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 5, color: "#CBD5E1", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={includeVerseNumbers}
                onChange={(e) => setIncludeVerseNumbers(e.target.checked)}
              />
              Verse #
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 5, color: "#CBD5E1", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={includeWatermark}
                onChange={(e) => setIncludeWatermark(e.target.checked)}
              />
              Ref Watermark
            </label>
          </div>
        </div>

        {/* Main 2-Column Workspace */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.05fr 1fr",
            gap: 16,
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          {/* LEFT PANE */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              minHeight: 0,
              overflow: "hidden",
              background: "#0D1117",
              border: "1px solid #1E2533",
              borderRadius: 10,
              padding: 14,
            }}
          >
            {mode === "lookup" ? (
              <>
                <div style={{ flexShrink: 0 }}>
                  <label style={labelStyle}>Search Reference or Keyword</label>
                  <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                    <Search
                      size={15}
                      color="#64748B"
                      style={{ position: "absolute", left: 10, pointerEvents: "none" }}
                    />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setSelectedPreviewIndex(0);
                      }}
                      placeholder='e.g. "John 3:16", "Psalm 23", "1 Corinthians 13", "Matthew 28:18-20"'
                      style={{ ...inputStyle, paddingLeft: 32, paddingRight: 30 }}
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery("")}
                        title="Clear search"
                        style={{
                          position: "absolute",
                          right: 6,
                          background: "transparent",
                          border: "none",
                          color: "#64748B",
                          cursor: "pointer",
                          padding: 4,
                        }}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Popular Quick-Pick Chips */}
                <div style={{ flexShrink: 0 }}>
                  <div style={{ ...labelStyle, marginBottom: 6 }}>Quick Worship & Sermon Passages</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {QUICK_REFS.map((ref) => {
                      const active =
                        searchQuery.trim().toLowerCase() === ref.toLowerCase();
                      return (
                        <button
                          key={ref}
                          type="button"
                          onClick={() => handleSelectQuickRef(ref)}
                          style={{
                            padding: "4px 9px",
                            borderRadius: 999,
                            border: `1px solid ${active ? "#F59E0B" : "#252C38"}`,
                            background: active ? "rgba(245, 158, 11, 0.2)" : "#161B24",
                            color: active ? "#FDE68A" : "#CBD5E1",
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          {ref}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Scrollable Passage Result / Verse Browser */}
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: "auto",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    paddingRight: 4,
                  }}
                >
                  {lookupResult.passage && lookupResult.matchedVerses.length > 0 ? (
                    <>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "6px 10px",
                          background: "#161B24",
                          border: "1px solid #252C38",
                          borderRadius: 7,
                        }}
                      >
                        <div>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#FBBF24" }}>
                            {lookupResult.resolvedRef}
                          </span>
                          <span style={{ fontSize: 11, color: "#94A3B8", marginLeft: 8 }}>
                            ({translation}) • {lookupResult.matchedVerses.length} verse
                            {lookupResult.matchedVerses.length > 1 ? "s" : ""}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const txt = lookupResult.matchedVerses
                              .map((v) => `${v.verse} ${v.text[translation]}`)
                              .join("\n");
                            setCustomRef(lookupResult.resolvedRef);
                            setPastedText(txt);
                            setMode("paste");
                          }}
                          style={{
                            background: "#1E293B",
                            border: "1px solid #334155",
                            color: "#93C5FD",
                            borderRadius: 5,
                            padding: "3px 8px",
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          Customize Text
                        </button>
                      </div>

                      {lookupResult.matchedVerses.map((v) => (
                        <div
                          key={v.verse}
                          style={{
                            padding: "9px 11px",
                            background: "#121721",
                            border: "1px solid #1E2533",
                            borderRadius: 7,
                            fontSize: 13,
                            lineHeight: 1.5,
                            color: "#E2E8F0",
                          }}
                        >
                          <span
                            className="mono"
                            style={{
                              fontSize: 11,
                              fontWeight: 800,
                              color: "#FBBF24",
                              marginRight: 7,
                            }}
                          >
                            {lookupResult.passage?.chapter}:{v.verse}
                          </span>
                          {v.text[translation]}
                        </div>
                      ))}

                      {lookupResult.suggestions.length > 1 && (
                        <div style={{ marginTop: 4 }}>
                          <div style={{ ...labelStyle, marginBottom: 6 }}>
                            All Indexed Passages ({lookupResult.suggestions.length})
                          </div>
                          <div style={{ display: "grid", gap: 5 }}>
                            {lookupResult.suggestions.map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => handleSelectQuickRef(p.title)}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  padding: "7px 10px",
                                  background: "#161B24",
                                  border: "1px solid #252C38",
                                  borderRadius: 6,
                                  color: "#CBD5E1",
                                  fontSize: 12,
                                  cursor: "pointer",
                                  textAlign: "left",
                                }}
                              >
                                <span style={{ fontWeight: 600 }}>{p.title}</span>
                                <span style={{ fontSize: 10.5, color: "#64748B" }}>
                                  {p.category} • {p.verses.length}v
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div
                      style={{
                        padding: 20,
                        textAlign: "center",
                        background: "#121721",
                        border: "1px dashed #2E3748",
                        borderRadius: 9,
                        color: "#94A3B8",
                        fontSize: 13,
                      }}
                    >
                      <p style={{ margin: "0 0 10px" }}>
                        <strong style={{ color: "#E2E8F0" }}>"{searchQuery}"</strong> is not in the offline quick-index.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setCustomRef(searchQuery.trim() || "Custom Scripture");
                          setPastedText("");
                          setMode("paste");
                        }}
                        style={{
                          padding: "7px 14px",
                          background: "#2563EB",
                          border: "1px solid #3B82F6",
                          borderRadius: 7,
                          color: "#FFFFFF",
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        Build "{searchQuery.trim() || "Passage"}" in Paste / Manual Builder
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              /* PASTE / MANUAL VERSE BUILDER MODE */
              <>
                <div style={{ flexShrink: 0 }}>
                  <label style={labelStyle}>Scripture Reference</label>
                  <input
                    type="text"
                    value={customRef}
                    onChange={(e) => {
                      setCustomRef(e.target.value);
                      setSelectedPreviewIndex(0);
                    }}
                    placeholder="e.g. Colossians 3:12-15 or Psalm 46:1-3"
                    style={inputStyle}
                  />
                </div>

                {/* Quick Manual Verse Append Row */}
                <div
                  style={{
                    flexShrink: 0,
                    background: "#121721",
                    border: "1px solid #1E2533",
                    borderRadius: 8,
                    padding: 10,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ ...labelStyle, marginBottom: 0 }}>Manual Verse Append</span>
                    <button
                      type="button"
                      onClick={() => setPastedText("")}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        background: "transparent",
                        border: "none",
                        color: "#94A3B8",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      <Trash2 size={12} /> Clear Text
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      type="text"
                      value={manualVerseNum}
                      onChange={(e) => setManualVerseNum(e.target.value)}
                      placeholder="#"
                      title="Verse number"
                      style={{ ...inputStyle, width: 56, textAlign: "center" }}
                    />
                    <input
                      type="text"
                      value={manualVerseInput}
                      onChange={(e) => setManualVerseInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAppendManualVerse();
                        }
                      }}
                      placeholder="Type single verse & press Enter to append..."
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    <button
                      type="button"
                      onClick={handleAppendManualVerse}
                      style={{
                        padding: "0 12px",
                        background: "#1E293B",
                        border: "1px solid #334155",
                        borderRadius: 6,
                        color: "#93C5FD",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <Plus size={14} /> Add
                    </button>
                  </div>
                </div>

                {/* Multi-Verse Textarea */}
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <label style={labelStyle}>
                    Paste Multi-Verse Scripture Text (Supports numbered or plain text)
                  </label>
                  <textarea
                    value={pastedText}
                    onChange={(e) => {
                      setPastedText(e.target.value);
                      setSelectedPreviewIndex(0);
                    }}
                    placeholder={"12 Therefore, as God's chosen people...\n13 Bear with each other..."}
                    style={{
                      flex: 1,
                      minHeight: 0,
                      width: "100%",
                      padding: 12,
                      background: "#0B0F17",
                      border: "1px solid #2B3545",
                      borderRadius: 8,
                      color: "#E2E8F0",
                      fontSize: 13,
                      lineHeight: 1.55,
                      resize: "none",
                      fontFamily: "inherit",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              </>
            )}
          </div>

          {/* RIGHT PANE: Live Slide Preview + Generated Deck */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              minHeight: 0,
              overflow: "hidden",
              background: "#0D1117",
              border: "1px solid #1E2533",
              borderRadius: 10,
              padding: 14,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexShrink: 0,
              }}
            >
              <span style={{ ...labelStyle, marginBottom: 0 }}>
                Live FOH Stage Preview ({generatedSlides.length} Slide
                {generatedSlides.length === 1 ? "" : "s"})
              </span>
              {generatedSlides.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button
                    type="button"
                    disabled={safePreviewIndex <= 0}
                    onClick={() => setSelectedPreviewIndex((i) => Math.max(0, i - 1))}
                    style={miniNavBtnStyle}
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span className="mono" style={{ fontSize: 11.5, color: "#94A3B8" }}>
                    {safePreviewIndex + 1} / {generatedSlides.length}
                  </span>
                  <button
                    type="button"
                    disabled={safePreviewIndex >= generatedSlides.length - 1}
                    onClick={() =>
                      setSelectedPreviewIndex((i) =>
                        Math.min(generatedSlides.length - 1, i + 1)
                      )
                    }
                    style={miniNavBtnStyle}
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              )}
            </div>

            {/* 16:9 Live Projection Stage Mockup */}
            <div
              style={{
                flexShrink: 0,
                aspectRatio: "16 / 9",
                width: "100%",
                maxHeight: 220,
                borderRadius: 10,
                background:
                  "radial-gradient(circle at 25% 20%, #1E293B 0%, #0B1120 60%, #05080F 100%)",
                border: "1px solid #334155",
                padding: "18px 24px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: "0.08em",
                    color: "#FBBF24",
                    background: "rgba(245, 158, 11, 0.14)",
                    border: "1px solid rgba(245, 158, 11, 0.35)",
                    padding: "2px 8px",
                    borderRadius: 999,
                  }}
                >
                  SCRIPTURE • {translation}
                </span>
                {activeSlide && (
                  <span className="mono" style={{ fontSize: 10.5, color: "#64748B" }}>
                    SLIDE {activeSlide.number}
                  </span>
                )}
              </div>

              <div
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  padding: "6px 8px",
                  overflow: "hidden",
                }}
              >
                {activeSlide ? (
                  <div
                    style={{
                      fontSize: 15,
                      lineHeight: 1.45,
                      fontWeight: 600,
                      color: "#F8FAFC",
                      whiteSpace: "pre-line",
                      textShadow: "0 2px 10px rgba(0,0,0,0.8)",
                    }}
                  >
                    {activeSlide.text.replace(/\n— .+$/, "")}
                  </div>
                ) : (
                  <div style={{ color: "#64748B", fontSize: 13 }}>
                    Enter or select a scripture passage to preview formatted slides.
                  </div>
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  alignItems: "center",
                  minHeight: 18,
                }}
              >
                {activeSlide && includeWatermark && (
                  <span
                    style={{
                      fontSize: 11.5,
                      fontWeight: 700,
                      letterSpacing: "0.04em",
                      color: "#FCD34D",
                      opacity: 0.9,
                    }}
                  >
                    — {activeSlide.section}
                  </span>
                )}
              </div>
            </div>

            {/* Scrollable Generated Slide List */}
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 7,
                paddingRight: 4,
              }}
            >
              {generatedSlides.length === 0 ? (
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#64748B",
                    fontSize: 12.5,
                    padding: 20,
                  }}
                >
                  <Sparkles size={24} color="#475569" style={{ marginBottom: 8 }} />
                  No slides generated yet.
                </div>
              ) : (
                generatedSlides.map((s, idx) => {
                  const selected = idx === safePreviewIndex;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelectedPreviewIndex(idx)}
                      style={{
                        textAlign: "left",
                        padding: "9px 11px",
                        borderRadius: 8,
                        border: selected
                          ? "1px solid #F59E0B"
                          : "1px solid #1E2533",
                        background: selected ? "rgba(245, 158, 11, 0.12)" : "#121721",
                        color: "#E2E8F0",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          width: "100%",
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: selected ? "#FBBF24" : "#93C5FD",
                          }}
                        >
                          Slide {s.number} • {s.section}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            color: "#64748B",
                            textTransform: "uppercase",
                          }}
                        >
                          {s.kind}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "#CBD5E1",
                          whiteSpace: "pre-line",
                          lineHeight: 1.4,
                        }}
                      >
                        {s.text}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexShrink: 0,
            paddingTop: 4,
            borderTop: "1px solid #1E2533",
          }}
        >
          <div style={{ fontSize: 12, color: "#94A3B8" }}>
            {generatedSlides.length > 0 ? (
              <>
                Ready to add <strong style={{ color: "#FDE68A" }}>{resolvedTitle}</strong> (
                {generatedSlides.length} slide{generatedSlides.length === 1 ? "" : "s"})
              </>
            ) : (
              "Select or paste a scripture passage to continue."
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "8px 16px",
                background: "#1E2533",
                border: "1px solid #2E3748",
                borderRadius: 8,
                color: "#CBD5E1",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={generatedSlides.length === 0}
              onClick={handleAddToService}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "8px 18px",
                background: generatedSlides.length > 0 ? "#D97706" : "#334155",
                border: `1px solid ${generatedSlides.length > 0 ? "#F59E0B" : "#475569"}`,
                borderRadius: 8,
                color: "#FFFFFF",
                fontSize: 13,
                fontWeight: 700,
                cursor: generatedSlides.length > 0 ? "pointer" : "not-allowed",
                opacity: generatedSlides.length > 0 ? 1 : 0.6,
              }}
            >
              <Check size={16} /> Add Scripture to Service
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 700,
  color: "#94A3B8",
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 36,
  padding: "0 10px",
  background: "#0B0F17",
  border: "1px solid #2B3545",
  borderRadius: 7,
  color: "#FFFFFF",
  fontSize: 13,
  boxSizing: "border-box",
};

const compactSelectStyle: React.CSSProperties = {
  height: 28,
  padding: "0 8px",
  background: "#161B24",
  border: "1px solid #2E3748",
  borderRadius: 6,
  color: "#E2E8F0",
  fontSize: 12,
};

const miniNavBtnStyle: React.CSSProperties = {
  width: 26,
  height: 26,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#161B24",
  border: "1px solid #283344",
  borderRadius: 6,
  color: "#E2E8F0",
  cursor: "pointer",
};

export default BibleLookupModal;
