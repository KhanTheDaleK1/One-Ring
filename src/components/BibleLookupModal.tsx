import React, { useEffect, useMemo, useRef, useState } from "react";
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
  Globe,
  Key,
  Upload,
} from "lucide-react";
import type { SlideCue } from "../types";
import {
  bibleImportLocalFile,
  bibleListTranslations,
  bibleLookupPassage,
  bibleSaveKeys,
  isTauriRuntime,
  type BibleTranslationInfo,
} from "../bridge";

export type BibleTranslation = string;

export interface BibleLookupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddSlides: (title: string, slides: SlideCue[]) => void;
}

interface LivePassage {
  reference: string;
  chapter: number;
  verses: VerseEntry[];
  source?: string;
  copyrightNotice?: string;
}

interface VerseEntry {
  verse: number;
  text: Partial<Record<BibleTranslation, string>> & { KJV: string; WEB: string; ASV: string };
}

function getVerseText(v: VerseEntry, translation: BibleTranslation): string {
  const byTranslation = v.text as Partial<Record<BibleTranslation, string>>;
  return byTranslation[translation] || byTranslation.WEB || byTranslation.KJV || byTranslation.ASV || "";
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

const TRANSLATIONS: { id: BibleTranslation; name: string; apiId: string }[] = [
  { id: "BSB", name: "Berean Standard Bible (Modern Public Domain)", apiId: "web" },
  { id: "WEB", name: "World English Bible (Modern Public Domain)", apiId: "web" },
  { id: "KJV", name: "King James Version (1769)", apiId: "kjv" },
  { id: "ASV", name: "American Standard Version (1901)", apiId: "asv" },
  { id: "BBE", name: "Bible in Basic English", apiId: "bbe" },
  { id: "YLT", name: "Young's Literal Translation", apiId: "ylt" },
  { id: "DARBY", name: "Darby Translation", apiId: "darby" },
  { id: "DRA", name: "Douay-Rheims 1899 American Edition", apiId: "dra" },
  { id: "OEB-US", name: "Open English Bible (US)", apiId: "oeb-us" },
  { id: "OEB-CW", name: "Open English Bible (Commonwealth)", apiId: "oeb-cw" },
  { id: "WEBBE", name: "World English Bible (British)", apiId: "webbe" },
  { id: "WMB", name: "World Messianic Bible", apiId: "web" },
  { id: "LSV", name: "Literal Standard Version (Open License)", apiId: "asv" },
  { id: "GNV", name: "Geneva Bible (1599)", apiId: "kjv" },
  { id: "AKJV", name: "American King James Version", apiId: "kjv" },
];

const SCRIPTURE_DATASET: ScripturePassage[] = [
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
          KJV: "In the beginning God created the heaven and the earth.",
          WEB: "In the beginning God created the heavens and the earth.",
          ASV: "In the beginning God created the heavens and the earth.",
        },
      },
      {
        verse: 2,
        text: {
          KJV: "And the earth was without form, and void; and darkness was upon the face of the deep. And the Spirit of God moved upon the face of the waters.",
          WEB: "The earth was formless and empty. Darkness was on the surface of the deep, and God's Spirit was hovering over the surface of the waters.",
          ASV: "And the earth was waste and void; and darkness was upon the face of the deep: and the Spirit of God moved upon the face of the waters.",
        },
      },
      {
        verse: 3,
        text: {
          KJV: "And God said, Let there be light: and there was light.",
          WEB: "God said, \"Let there be light,\" and there was light.",
          ASV: "And God said, Let there be light: and there was light.",
        },
      },
      {
        verse: 4,
        text: {
          KJV: "And God saw the light, that it was good: and God divided the light from the darkness.",
          WEB: "God saw the light, and saw that it was good. God divided the light from the darkness.",
          ASV: "And God saw the light, that it was good: and God divided the light from the darkness.",
        },
      },
      {
        verse: 5,
        text: {
          KJV: "And God called the light Day, and the darkness he called Night. And the evening and the morning were the first day.",
          WEB: "God called the light \"day\", and the darkness he called \"night\". There was evening and there was morning, the first day.",
          ASV: "And God called the light Day, and the darkness he called Night. And there was evening and there was morning, the first day.",
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
          KJV: "The LORD is my shepherd; I shall not want.",
          WEB: "Yahweh is my shepherd: I shall lack nothing.",
          ASV: "Jehovah is my shepherd; I shall not want.",
        },
      },
      {
        verse: 2,
        text: {
          KJV: "He maketh me to lie down in green pastures: he leadeth me beside the still waters.",
          WEB: "He makes me lie down in green pastures. He leads me beside still waters.",
          ASV: "He maketh me to lie down in green pastures; He leadeth me beside still waters.",
        },
      },
      {
        verse: 3,
        text: {
          KJV: "He restoreth my soul: he leadeth me in the paths of righteousness for his name's sake.",
          WEB: "He restores my soul. He guides me in the paths of righteousness for his name's sake.",
          ASV: "He restoreth my soul: He guideth me in the paths of righteousness for his name's sake.",
        },
      },
      {
        verse: 4,
        text: {
          KJV: "Yea, though I walk through the valley of the shadow of death, I will fear no evil: for thou art with me; thy rod and thy staff they comfort me.",
          WEB: "Even though I walk through the valley of the shadow of death, I will fear no evil, for you are with me. Your rod and your staff, they comfort me.",
          ASV: "Yea, though I walk through the valley of the shadow of death, I will fear no evil; for thou art with me; thy rod and thy staff, they comfort me.",
        },
      },
      {
        verse: 5,
        text: {
          KJV: "Thou preparest a table before me in the presence of mine enemies: thou anointest my head with oil; my cup runneth over.",
          WEB: "You prepare a table before me in the presence of my enemies. You anoint my head with oil. My cup runs over.",
          ASV: "Thou preparest a table before me in the presence of mine enemies: thou hast anointed my head with oil; my cup runneth over.",
        },
      },
      {
        verse: 6,
        text: {
          KJV: "Surely goodness and mercy shall follow me all the days of my life: and I will dwell in the house of the LORD for ever.",
          WEB: "Surely goodness and loving kindness shall follow me all the days of my life, and I will dwell in the house of Yahweh forever.",
          ASV: "Surely goodness and lovingkindness shall follow me all the days of my life, and I will dwell in the house of Jehovah for ever.",
        },
      },
    ],
  },
  {
    id: "psalm-91",
    book: "Psalm",
    aliases: ["psalms", "ps", "psa"],
    chapter: 91,
    title: "Psalm 91:1-4",
    category: "Psalms",
    verses: [
      {
        verse: 1,
        text: {
          KJV: "He that dwelleth in the secret place of the most High shall abide under the shadow of the Almighty.",
          WEB: "He who dwells in the secret place of the Most High will rest under the shadow of the Almighty.",
          ASV: "He that dwelleth in the secret place of the Most High shall abide under the shadow of the Almighty.",
        },
      },
      {
        verse: 2,
        text: {
          KJV: "I will say of the LORD, He is my refuge and my fortress: my God; in him will I trust.",
          WEB: "I will say of Yahweh, \"He is my refuge and my fortress; my God, in whom I trust.\"",
          ASV: "I will say of Jehovah, He is my refuge and my fortress; my God, in whom I trust.",
        },
      },
      {
        verse: 3,
        text: {
          KJV: "Surely he shall deliver thee from the snare of the fowler, and from the noisome pestilence.",
          WEB: "For he will deliver you from the snare of the fowler, and from the deadly pestilence.",
          ASV: "For he will deliver thee from the snare of the fowler, and from the deadly pestilence.",
        },
      },
      {
        verse: 4,
        text: {
          KJV: "He shall cover thee with his feathers, and under his wings shalt thou trust: his truth shall be thy shield and buckler.",
          WEB: "He will cover you with his feathers, and under his wings you will take refuge. His truth will be your shield and rampart.",
          ASV: "He will cover thee with his pinions, and under his wings shalt thou take refuge: his truth is a shield and a buckler.",
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
          KJV: "Make a joyful noise unto the LORD, all ye lands.",
          WEB: "Shout for joy to Yahweh, all you lands!",
          ASV: "Make a joyful noise unto Jehovah, all ye lands.",
        },
      },
      {
        verse: 2,
        text: {
          KJV: "Serve the LORD with gladness: come before his presence with singing.",
          WEB: "Serve Yahweh with gladness. Come before his presence with singing.",
          ASV: "Serve Jehovah with gladness: come before his presence with singing.",
        },
      },
      {
        verse: 3,
        text: {
          KJV: "Know ye that the LORD he is God: it is he that hath made us, and not we ourselves; we are his people, and the sheep of his pasture.",
          WEB: "Know that Yahweh, he is God. It is he who has made us, and not we ourselves. We are his people, and the sheep of his pasture.",
          ASV: "Know ye that Jehovah he is God: it is he that hath made us, and not we ourselves; we are his people, and the sheep of his pasture.",
        },
      },
      {
        verse: 4,
        text: {
          KJV: "Enter into his gates with thanksgiving, and into his courts with praise: be thankful unto him, and bless his name.",
          WEB: "Enter into his gates with thanksgiving, and into his courts with praise. Give thanks to him, and bless his name.",
          ASV: "Enter into his gates with thanksgiving, and into his courts with praise: give thanks unto him, and bless his name.",
        },
      },
      {
        verse: 5,
        text: {
          KJV: "For the LORD is good; his mercy is everlasting; and his truth endureth to all generations.",
          WEB: "For Yahweh is good. His loving kindness endures forever, his faithfulness to all generations.",
          ASV: "For Jehovah is good; his lovingkindness is everlasting; and his faithfulness unto all generations.",
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
          KJV: "Trust in the LORD with all thine heart; and lean not unto thine own understanding.",
          WEB: "Trust in Yahweh with all your heart, and don't lean on your own understanding.",
          ASV: "Trust in Jehovah with all thy heart, and lean not upon thine own understanding.",
        },
      },
      {
        verse: 6,
        text: {
          KJV: "In all thy ways acknowledge him, and he shall direct thy paths.",
          WEB: "In all your ways acknowledge him, and he will make your paths straight.",
          ASV: "In all thy ways acknowledge him, and he will make thy paths straight.",
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
          KJV: "Hast thou not known? hast thou not heard, that the everlasting God, the LORD, the Creator of the ends of the earth, fainteth not, neither is weary? there is no searching of his understanding.",
          WEB: "Have you not known? Have you not heard? The everlasting God, Yahweh, the Creator of the ends of the earth, doesn't faint. He isn't weary. His understanding is unsearchable.",
          ASV: "Hast thou not known? hast thou not heard, that the everlasting God, Jehovah, the Creator of the ends of the earth, fainteth not, neither is weary? there is no searching of his understanding.",
        },
      },
      {
        verse: 29,
        text: {
          KJV: "He giveth power to the faint; and to them that have no might he increaseth strength.",
          WEB: "He gives power to the faint; and to him who has no might he increases strength.",
          ASV: "He giveth power to the faint; and to him that hath no might he increaseth strength.",
        },
      },
      {
        verse: 30,
        text: {
          KJV: "Even the youths shall faint and be weary, and the young men shall utterly fall:",
          WEB: "Even the youths faint and get weary, and the young men utterly fall;",
          ASV: "Even the youths shall faint and be weary, and the young men shall utterly fall;",
        },
      },
      {
        verse: 31,
        text: {
          KJV: "But they that wait upon the LORD shall renew their strength; they shall mount up with wings as eagles; they shall run, and not be weary; and they shall walk, and not faint.",
          WEB: "But those who wait for Yahweh will renew their strength. They will mount up with wings like eagles. They will run, and not be weary. They will walk, and not faint.",
          ASV: "But they that wait for Jehovah shall renew their strength; they shall mount up with wings as eagles; they shall run, and not be weary; they shall walk, and not faint.",
        },
      },
    ],
  },
  {
    id: "matthew-5",
    book: "Matthew",
    aliases: ["matt", "mt"],
    chapter: 5,
    title: "Matthew 5:3-10",
    category: "Gospel",
    verses: [
      {
        verse: 3,
        text: {
          KJV: "Blessed are the poor in spirit: for theirs is the kingdom of heaven.",
          WEB: "Blessed are the poor in spirit, for theirs is the Kingdom of Heaven.",
          ASV: "Blessed are the poor in spirit: for theirs is the kingdom of heaven.",
        },
      },
      {
        verse: 4,
        text: {
          KJV: "Blessed are they that mourn: for they shall be comforted.",
          WEB: "Blessed are those who mourn, for they shall be comforted.",
          ASV: "Blessed are they that mourn: for they shall be comforted.",
        },
      },
      {
        verse: 5,
        text: {
          KJV: "Blessed are the meek: for they shall inherit the earth.",
          WEB: "Blessed are the gentle, for they shall inherit the earth.",
          ASV: "Blessed are the meek: for they shall inherit the earth.",
        },
      },
      {
        verse: 6,
        text: {
          KJV: "Blessed are they which do hunger and thirst after righteousness: for they shall be filled.",
          WEB: "Blessed are those who hunger and thirst after righteousness, for they shall be filled.",
          ASV: "Blessed are they that hunger and thirst after righteousness: for they shall be filled.",
        },
      },
      {
        verse: 7,
        text: {
          KJV: "Blessed are the merciful: for they shall obtain mercy.",
          WEB: "Blessed are the merciful, for they shall obtain mercy.",
          ASV: "Blessed are the merciful: for they shall obtain mercy.",
        },
      },
      {
        verse: 8,
        text: {
          KJV: "Blessed are the pure in heart: for they shall see God.",
          WEB: "Blessed are the pure in heart, for they shall see God.",
          ASV: "Blessed are the pure in heart: for they shall see God.",
        },
      },
      {
        verse: 9,
        text: {
          KJV: "Blessed are the peacemakers: for they shall be called the children of God.",
          WEB: "Blessed are the peacemakers, for they shall be called children of God.",
          ASV: "Blessed are the peacemakers: for they shall be called sons of God.",
        },
      },
      {
        verse: 10,
        text: {
          KJV: "Blessed are they which are persecuted for righteousness' sake: for theirs is the kingdom of heaven.",
          WEB: "Blessed are those who have been persecuted for righteousness' sake, for theirs is the Kingdom of Heaven.",
          ASV: "Blessed are they that have been persecuted for righteousness' sake: for theirs is the kingdom of heaven.",
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
          KJV: "And Jesus came and spake unto them, saying, All power is given unto me in heaven and in earth.",
          WEB: "Jesus came to them and spoke to them, saying, \"All authority has been given to me in heaven and on earth,",
          ASV: "And Jesus came to them and spake unto them, saying, All authority hath been given unto me in heaven and on earth.",
        },
      },
      {
        verse: 19,
        text: {
          KJV: "Go ye therefore, and teach all nations, baptizing them in the name of the Father, and of the Son, and of the Holy Ghost:",
          WEB: "Go therefore and make disciples of all nations, baptizing them in the name of the Father and of the Son and of the Holy Spirit,",
          ASV: "Go ye therefore, and make disciples of all the nations, baptizing them into the name of the Father and of the Son and of the Holy Spirit:",
        },
      },
      {
        verse: 20,
        text: {
          KJV: "Teaching them to observe all things whatsoever I have commanded you: and, lo, I am with you always, even unto the end of the world. Amen.",
          WEB: "teaching them to observe all things that I commanded you. Behold, I am with you always, even to the end of the age.\" Amen.",
          ASV: "teaching them to observe all things whatsoever I commanded you: and lo, I am with you always, even unto the end of the world.",
        },
      },
    ],
  },
  {
    id: "john-1",
    book: "John",
    aliases: ["jn", "jhn"],
    chapter: 1,
    title: "John 1:1-5",
    category: "Gospel",
    verses: [
      {
        verse: 1,
        text: {
          KJV: "In the beginning was the Word, and the Word was with God, and the Word was God.",
          WEB: "In the beginning was the Word, and the Word was with God, and the Word was God.",
          ASV: "In the beginning was the Word, and the Word was with God, and the Word was God.",
        },
      },
      {
        verse: 2,
        text: {
          KJV: "The same was in the beginning with God.",
          WEB: "The same was in the beginning with God.",
          ASV: "The same was in the beginning with God.",
        },
      },
      {
        verse: 3,
        text: {
          KJV: "All things were made by him; and without him was not any thing made that was made.",
          WEB: "All things were made through him. Without him was not anything made that has been made.",
          ASV: "All things were made by him; and without him was not anything made that hath been made.",
        },
      },
      {
        verse: 4,
        text: {
          KJV: "In him was life; and the life was the light of men.",
          WEB: "In him was life, and the life was the light of men.",
          ASV: "In him was life; and the life was the light of men.",
        },
      },
      {
        verse: 5,
        text: {
          KJV: "And the light shineth in darkness; and the darkness comprehended it not.",
          WEB: "The light shines in the darkness, and the darkness has not overcome it.",
          ASV: "And the light shineth in the darkness; and the darkness apprehended it not.",
        },
      },
    ],
  },
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
          KJV: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.",
          WEB: "For God so loved the world, that he gave his only begotten Son, that whoever believes in him should not perish, but have eternal life.",
          ASV: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth on him should not perish, but have eternal life.",
        },
      },
      {
        verse: 17,
        text: {
          KJV: "For God sent not his Son into the world to condemn the world; but that the world through him might be saved.",
          WEB: "For God didn't send his Son into the world to judge the world, but that the world should be saved through him.",
          ASV: "For God sent not the Son into the world to judge the world; but that the world should be saved through him.",
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
          KJV: "And we know that all things work together for good to them that love God, to them who are the called according to his purpose.",
          WEB: "We know that all things work together for good for those who love God, for those who are called according to his purpose.",
          ASV: "And we know that to them that love God all things work together for good, even to them that are called according to his purpose.",
        },
      },
      {
        verse: 29,
        text: {
          KJV: "For whom he did foreknow, he also did predestinate to be conformed to the image of his Son, that he might be the firstborn among many brethren.",
          WEB: "For whom he foreknew, he also predestined to be conformed to the image of his Son, that he might be the firstborn among many brothers.",
          ASV: "For whom he foreknew, he also foreordained to be conformed to the image of his Son, that he might be the firstborn among many brethren.",
        },
      },
      {
        verse: 30,
        text: {
          KJV: "Moreover whom he did predestinate, them he also called: and whom he called, them he also justified: and whom he justified, them he also glorified.",
          WEB: "Whom he predestined, those he also called. Whom he called, those he also justified. Whom he justified, those he also glorified.",
          ASV: "And whom he foreordained, them he also called: and whom he called, them he also justified: and whom he justified, them he also glorified.",
        },
      },
      {
        verse: 31,
        text: {
          KJV: "What shall we then say to these things? If God be for us, who can be against us?",
          WEB: "What then shall we say to these things? If God is for us, who can be against us?",
          ASV: "What then shall we say to these things? If God is for us, who is against us?",
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
          KJV: "Though I speak with the tongues of men and of angels, and have not charity, I am become as sounding brass, or a tinkling cymbal.",
          WEB: "If I speak with the tongues of men and of angels, but have not love, I have become sounding brass or a clanging cymbal.",
          ASV: "If I speak with the tongues of men and of angels, but have not love, I am become sounding brass, or a clanging cymbal.",
        },
      },
      {
        verse: 2,
        text: {
          KJV: "And though I have the gift of prophecy, and understand all mysteries, and all knowledge; and though I have all faith, so that I could remove mountains, and have not charity, I am nothing.",
          WEB: "If I have the gift of prophecy, and know all mysteries and all knowledge; and if I have all faith, so as to remove mountains, but don't have love, I am nothing.",
          ASV: "And if I have the gift of prophecy, and know all mysteries and all knowledge; and if I have all faith, so as to remove mountains, but have not love, I am nothing.",
        },
      },
      {
        verse: 3,
        text: {
          KJV: "And though I bestow all my goods to feed the poor, and though I give my body to be burned, and have not charity, it profiteth me nothing.",
          WEB: "If I give away all my goods to feed the poor, and if I give my body to be burned, but don't have love, it profits me nothing.",
          ASV: "And if I bestow all my goods to feed the poor, and if I give my body to be burned, but have not love, it profiteth me nothing.",
        },
      },
      {
        verse: 4,
        text: {
          KJV: "Charity suffereth long, and is kind; charity envieth not; charity vaunteth not itself, is not puffed up,",
          WEB: "Love is patient and is kind. Love doesn't envy. Love doesn't brag, is not puffed up,",
          ASV: "Love suffereth long, and is kind; love envieth not; love vaunteth not itself, is not puffed up,",
        },
      },
      {
        verse: 5,
        text: {
          KJV: "Doth not behave itself unseemly, seeketh not her own, is not easily provoked, thinketh no evil;",
          WEB: "doesn't behave itself unseemly, does not seek its own, is not easily provoked, thinks no evil;",
          ASV: "doth not behave itself unseemly, seeketh not its own, is not easily provoked, taketh no account of evil;",
        },
      },
      {
        verse: 6,
        text: {
          KJV: "Rejoiceth not in iniquity, but rejoiceth in the truth;",
          WEB: "doesn't rejoice in unrighteousness, but rejoices with the truth;",
          ASV: "rejoiceth not in unrighteousness, but rejoiceth with the truth;",
        },
      },
      {
        verse: 7,
        text: {
          KJV: "Beareth all things, believeth all things, hopeth all things, endureth all things.",
          WEB: "bears all things, believes all things, hopes all things, endures all things.",
          ASV: "beareth all things, believeth all things, hopeth all things, endureth all things.",
        },
      },
      {
        verse: 8,
        text: {
          KJV: "Charity never faileth: but whether there be prophecies, they shall fail; whether there be tongues, they shall cease; whether there be knowledge, it shall vanish away.",
          WEB: "Love never fails. But where there are prophecies, they will be done away with. Where there are various tongues, they will cease. Where there is knowledge, it will be done away with.",
          ASV: "Love never faileth: but whether there be prophecies, they shall be done away; whether there be tongues, they shall cease; whether there be knowledge, it shall be done away.",
        },
      },
      {
        verse: 13,
        text: {
          KJV: "And now abideth faith, hope, charity, these three; but the greatest of these is charity.",
          WEB: "But now remains faith, hope, love, these three. The greatest of these is love.",
          ASV: "But now abideth faith, hope, love, these three; and the greatest of these is love.",
        },
      },
    ],
  },
  {
    id: "ephesians-2",
    book: "Ephesians",
    aliases: ["eph"],
    chapter: 2,
    title: "Ephesians 2:8-10",
    category: "Epistles",
    verses: [
      {
        verse: 8,
        text: {
          KJV: "For by grace are ye saved through faith; and that not of yourselves: it is the gift of God:",
          WEB: "For by grace you have been saved through faith, and that not of yourselves; it is the gift of God,",
          ASV: "For by grace have ye been saved through faith; and that not of yourselves, it is the gift of God;",
        },
      },
      {
        verse: 9,
        text: {
          KJV: "Not of works, lest any man should boast.",
          WEB: "not of works, that no one would boast.",
          ASV: "not of works, that no man should glory.",
        },
      },
      {
        verse: 10,
        text: {
          KJV: "For we are his workmanship, created in Christ Jesus unto good works, which God hath before ordained that we should walk in them.",
          WEB: "For we are his workmanship, created in Christ Jesus for good works, which God prepared before that we would walk in them.",
          ASV: "For we are his workmanship, created in Christ Jesus for good works, which God afore prepared that we should walk in them.",
        },
      },
    ],
  },
  {
    id: "philippians-4",
    book: "Philippians",
    aliases: ["phil", "php"],
    chapter: 4,
    title: "Philippians 4:6-8, 13",
    category: "Epistles",
    verses: [
      {
        verse: 6,
        text: {
          KJV: "Be careful for nothing; but in every thing by prayer and supplication with thanksgiving let your requests be made known unto God.",
          WEB: "In nothing be anxious, but in everything, by prayer and petition with thanksgiving, let your requests be made known to God.",
          ASV: "In nothing be anxious; but in everything by prayer and supplication with thanksgiving let your requests be made known unto God.",
        },
      },
      {
        verse: 7,
        text: {
          KJV: "And the peace of God, which passeth all understanding, shall keep your hearts and minds through Christ Jesus.",
          WEB: "And the peace of God, which surpasses all understanding, will guard your hearts and your thoughts in Christ Jesus.",
          ASV: "And the peace of God, which passeth all understanding, shall guard your hearts and your thoughts in Christ Jesus.",
        },
      },
      {
        verse: 8,
        text: {
          KJV: "Finally, brethren, whatsoever things are true, whatsoever things are honest, whatsoever things are just, whatsoever things are pure, whatsoever things are lovely, whatsoever things are of good report; if there be any virtue, and if there be any praise, think on these things.",
          WEB: "Finally, brothers, whatever things are true, whatever things are honorable, whatever things are just, whatever things are pure, whatever things are lovely, whatever things are of good report; if there is any virtue and if there is any praise, think about these things.",
          ASV: "Finally, brethren, whatsoever things are true, whatsoever things are honorable, whatsoever things are just, whatsoever things are pure, whatsoever things are lovely, whatsoever things are of good report; if there be any virtue, and if there be any praise, think on these things.",
        },
      },
      {
        verse: 13,
        text: {
          KJV: "I can do all things through Christ which strengtheneth me.",
          WEB: "I can do all things through Christ who strengthens me.",
          ASV: "I can do all things through him that strengtheneth me.",
        },
      },
    ],
  },
  {
    id: "colossians-3",
    book: "Colossians",
    aliases: ["col", "colossians"],
    chapter: 3,
    title: "Colossians 3:12-17",
    category: "Epistles",
    verses: [
      {
        verse: 12,
        text: {
          KJV: "Put on therefore, as the elect of God, holy and beloved, bowels of mercies, kindness, humbleness of mind, meekness, longsuffering;",
          WEB: "Put on therefore, as God's chosen ones, holy and beloved, a heart of compassion, kindness, lowliness, humility, and perseverance;",
          ASV: "Put on therefore, as God's elect, holy and beloved, a heart of compassion, kindness, lowliness, meekness, longsuffering;",
        },
      },
      {
        verse: 13,
        text: {
          KJV: "Forbearing one another, and forgiving one another, if any man have a quarrel against any: even as Christ forgave you, so also do ye.",
          WEB: "bearing with one another, and forgiving each other, if any man has a complaint against any; even as Christ forgave you, so you also do.",
          ASV: "forbearing one another, and forgiving each other, if any man have a complaint against any; even as the Lord forgave you, so also do ye:",
        },
      },
      {
        verse: 14,
        text: {
          KJV: "And above all these things put on charity, which is the bond of perfectness.",
          WEB: "Above all these things, walk in love, which is the bond of perfection.",
          ASV: "and above all these things put on love, which is the bond of perfectness.",
        },
      },
      {
        verse: 15,
        text: {
          KJV: "And let the peace of God rule in your hearts, to the which also ye are called in one body; and be ye thankful.",
          WEB: "And let the peace of God rule in your hearts, to which also you were called in one body; and be thankful.",
          ASV: "And let the peace of God rule in your hearts, to the which also ye were called in one body; and be ye thankful.",
        },
      },
      {
        verse: 16,
        text: {
          KJV: "Let the word of Christ dwell in you richly in all wisdom; teaching and admonishing one another in psalms and hymns and spiritual songs, singing with grace in your hearts to the Lord.",
          WEB: "Let the word of Christ dwell in you richly; in all wisdom teaching and admonishing one another with psalms, hymns, and spiritual songs, singing with grace in your heart to the Lord.",
          ASV: "Let the word of Christ dwell in you richly in all wisdom; teaching and admonishing one another with psalms and hymns and spiritual songs, singing with grace in your hearts to God.",
        },
      },
      {
        verse: 17,
        text: {
          KJV: "And whatsoever ye do in word or deed, do all in the name of the Lord Jesus, giving thanks to God and the Father by him.",
          WEB: "Whatever you do, in word or in deed, do all in the name of the Lord Jesus, giving thanks to God the Father through him.",
          ASV: "And whatsoever ye do, in word or in deed, do all in the name of the Lord Jesus, giving thanks to God the Father through him.",
        },
      },
    ],
  },
  {
    id: "hebrews-11",
    book: "Hebrews",
    aliases: ["heb"],
    chapter: 11,
    title: "Hebrews 11:1-3",
    category: "Epistles",
    verses: [
      {
        verse: 1,
        text: {
          KJV: "Now faith is the substance of things hoped for, the evidence of things not seen.",
          WEB: "Now faith is assurance of things hoped for, proof of things not seen.",
          ASV: "Now faith is assurance of things hoped for, a conviction of things not seen.",
        },
      },
      {
        verse: 2,
        text: {
          KJV: "For by it the elders obtained a good report.",
          WEB: "For by this, the elders obtained approval.",
          ASV: "For thereby the elders obtained witness.",
        },
      },
      {
        verse: 3,
        text: {
          KJV: "Through faith we understand that the worlds were framed by the word of God, so that things which are seen were not made of things which do appear.",
          WEB: "By faith, we understand that the universe has been framed by the word of God, so that what is seen has not been made out of things which are visible.",
          ASV: "By faith we understand that the worlds have been framed by the word of God, so that what is seen has not been made out of things which appear.",
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
          KJV: "'For I know the thoughts that I think toward you, saith the LORD, thoughts of peace, and not of evil, to give you an expected end.'",
          WEB: "'For I know the plans that I have concerning you,' says Yahweh, 'plans to prosper you, and not to harm you, plans to give you hope and a future.'",
          ASV: "'For I know the thoughts that I think toward you, saith Jehovah, thoughts of peace, and not of evil, to give you an expected end.'",
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
          KJV: "Have not I commanded thee? Be strong and of a good courage; be not afraid, neither be thou dismayed: for the LORD thy God is with thee whithersoever thou goest.",
          WEB: "Haven't I commanded you? Be strong and courageous. Don't be afraid, neither be dismayed, for Yahweh your God is with you wherever you go.",
          ASV: "Have not I commanded thee? Be strong and of good courage; be not afraid, neither be thou dismayed: for Jehovah thy God is with thee whithersoever thou goest.",
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
          KJV: "God is our refuge and strength, a very present help in trouble.",
          WEB: "God is our refuge and strength, a very present help in trouble.",
          ASV: "God is our refuge and strength, a very present help in trouble.",
        },
      },
      {
        verse: 2,
        text: {
          KJV: "Therefore will not we fear, though the earth be removed, and though the mountains be carried into the midst of the sea;",
          WEB: "Therefore we won't be afraid, though the earth changes, though the mountains are shaken into the heart of the seas;",
          ASV: "Therefore will not we fear, though the earth do change, and though the mountains be shaken into the heart of the seas;",
        },
      },
      {
        verse: 3,
        text: {
          KJV: "Though the waters thereof roar and be troubled, though the mountains shake with the swelling thereof.",
          WEB: "though its waters roar and are troubled, though the mountains tremble with its swelling.",
          ASV: "Though the waters thereof roar and are troubled, though the mountains shake with the swelling thereof.",
        },
      },
      {
        verse: 10,
        text: {
          KJV: "Be still, and know that I am God: I will be exalted among the heathen, I will be exalted in the earth.",
          WEB: "\"Be still, and know that I am God. I will be exalted among the nations. I will be exalted in the earth.\"",
          ASV: "Be still, and know that I am God: I will be exalted among the nations, I will be exalted in the earth.",
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
          KJV: "Come unto me, all ye that labour and are heavy laden, and I will give you rest.",
          WEB: "Come to me, all you who labor and are heavily burdened, and I will give you rest.",
          ASV: "Come unto me, all ye that labour and are heavy laden, and I will give you rest.",
        },
      },
      {
        verse: 29,
        text: {
          KJV: "Take my yoke upon you, and learn of me; for I am meek and lowly in heart: and ye shall find rest unto your souls.",
          WEB: "Take my yoke upon you, and learn from me, for I am gentle and humble in heart; and you will find rest for your souls.",
          ASV: "Take my yoke upon you, and learn of me, for I am meek and lowly in heart: and ye shall find rest unto your souls.",
        },
      },
      {
        verse: 30,
        text: {
          KJV: "For my yoke is easy, and my burden is light.",
          WEB: "For my yoke is easy, and my burden is light.",
          ASV: "For my yoke is easy, and my burden is light.",
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
          KJV: "I beseech you therefore, brethren, by the mercies of God, that ye present your bodies a living sacrifice, holy, acceptable unto God, which is your reasonable service.",
          WEB: "I beg you therefore, brothers, by the mercies of God, to present your bodies a living sacrifice, holy, acceptable to God, which is your spiritual service.",
          ASV: "I beseech you therefore, brethren, by the mercies of God, to present your bodies a living sacrifice, holy, acceptable to God, which is your spiritual service.",
        },
      },
      {
        verse: 2,
        text: {
          KJV: "And be not conformed to this world: but be ye transformed by the renewing of your mind, that ye may prove what is that good, and acceptable, and perfect, will of God.",
          WEB: "Don't be conformed to this world, but be transformed by the renewing of your mind, so that you may prove what is the good, well-pleasing, and perfect will of God.",
          ASV: "And be not fashioned according to this world: but be ye transformed by the renewing of your mind, that ye may prove what is the good and acceptable and perfect will of God.",
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
          KJV: "But the fruit of the Spirit is love, joy, peace, longsuffering, gentleness, goodness, faith,",
          WEB: "But the fruit of the Spirit is love, joy, peace, patience, kindness, goodness, faith,",
          ASV: "But the fruit of the Spirit is love, joy, peace, longsuffering, kindness, goodness, faith,",
        },
      },
      {
        verse: 23,
        text: {
          KJV: "Meekness, temperance: against such there is no law.",
          WEB: "gentleness, self-control. Against such things there is no law.",
          ASV: "meekness, temperance: against such there is no law.",
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
          KJV: "If my people, which are called by my name, shall humble themselves, and pray, and seek my face, and turn from their wicked ways; then will I hear from heaven, and will forgive their sin, and will heal their land.",
          WEB: "if my people, who are called by my name, will humble themselves, and pray, and seek my face, and turn from their wicked ways, then I will hear from heaven and will forgive their sin and will heal their land.",
          ASV: "If my people, which are called by my name, shall humble themselves, and pray, and seek my face, and turn from their wicked ways; then will I hear from heaven, and will forgive their sin, and will heal their land.",
        },
      },
    ],
  },
];

const QUICK_REFS = [
  "Genesis 1:1",
  "Psalm 23",
  "Psalm 91:1-4",
  "Psalm 100",
  "Proverbs 3:5-6",
  "Isaiah 40:31",
  "Matthew 5:3-10",
  "Matthew 28:18-20",
  "John 1:1-5",
  "John 3:16",
  "Romans 8:28",
  "1 Corinthians 13",
  "Ephesians 2:8-10",
  "Philippians 4:6-8",
  "Philippians 4:13",
  "Colossians 3:12-17",
  "Hebrews 11:1-3",
  "Jeremiah 29:11",
  "Joshua 1:9",
  "Psalm 46:1-10",
  "Matthew 11:28-30",
  "Romans 12:1-2",
  "Galatians 5:22-23",
  "2 Chronicles 7:14",
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
    versesPerSlide: 1 | 2 | 3;
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
    return {
      passage: null,
      matchedVerses: [],
      resolvedRef: q,
      suggestions: [],
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
    return p.verses.some((v) => getVerseText(v, translation).toLowerCase().includes(lower));
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
  const [translation, setTranslation] = useState<BibleTranslation>("KJV");
  const [catalog, setCatalog] = useState<BibleTranslationInfo[]>([]);
  const [setupKeyInput, setSetupKeyInput] = useState("");
  const [localFileInput, setLocalFileInput] = useState("");
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupMessage, setSetupMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    if (isTauriRuntime()) {
      bibleListTranslations()
        .then((list) => {
          if (!cancelled && Array.isArray(list) && list.length > 0) {
            setCatalog(list);
          }
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const effectiveCatalog: BibleTranslationInfo[] = useMemo(() => {
    if (catalog.length > 0) return catalog;
    return TRANSLATIONS.map((t) => ({
      id: t.id,
      name: t.name,
      year: "Open",
      category: "open",
      categoryLabel: "Built-In Public Domain / Open",
      description: t.name,
      status: "ready",
      provider: "open_online",
      localFilePath: null,
    }));
  }, [catalog]);

  const groupedCatalog = useMemo(() => {
    const groups: { label: string; items: BibleTranslationInfo[] }[] = [];
    const byLabel = new Map<string, BibleTranslationInfo[]>();
    for (const item of effectiveCatalog) {
      const arr = byLabel.get(item.categoryLabel) || [];
      arr.push(item);
      byLabel.set(item.categoryLabel, arr);
    }
    for (const [label, items] of byLabel.entries()) {
      groups.push({ label, items });
    }
    return groups;
  }, [effectiveCatalog]);

  const activeCatalogEntry = useMemo(
    () => effectiveCatalog.find((t) => t.id === translation) || effectiveCatalog[0],
    [effectiveCatalog, translation]
  );
  const [mode, setMode] = useState<"lookup" | "paste">("lookup");
  const [searchQuery, setSearchQuery] = useState("");
  const [customRef, setCustomRef] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [manualVerseInput, setManualVerseInput] = useState("");
  const [manualVerseNum, setManualVerseNum] = useState("1");
  const [versesPerSlide, setVersesPerSlide] = useState<1 | 2 | 3>(2);
  const [maxLinesPerSlide, setMaxLinesPerSlide] = useState<number>(3);
  const [includeVerseNumbers, setIncludeVerseNumbers] = useState(true);
  const [includeWatermark, setIncludeWatermark] = useState(true);
  const [selectedPreviewIndex, setSelectedPreviewIndex] = useState(0);
  const [livePassage, setLivePassage] = useState<LivePassage | null>(null);
  const [isOnlineLoading, setIsOnlineLoading] = useState(false);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const onlineAbortRef = useRef<AbortController | null>(null);

  const selectedTr = TRANSLATIONS.find((t) => t.id === translation) ?? TRANSLATIONS[0];

  const lookupResult = useMemo(
    () => resolveLookupQuery(searchQuery, translation),
    [searchQuery, translation]
  );

  const generatedSlides = useMemo(() => {
    if (mode === "lookup") {
      let sourceVerses: ParsedVerse[] | null = null;
      let sourceRef = "";
      if (livePassage && livePassage.verses.length > 0) {
        sourceRef = livePassage.reference;
        sourceVerses = livePassage.verses.map((v) => ({
          verseNum: v.verse,
          text: getVerseText(v, translation),
        }));
      } else if (lookupResult.passage && lookupResult.matchedVerses.length > 0) {
        sourceRef = lookupResult.resolvedRef;
        sourceVerses = lookupResult.matchedVerses.map((v) => ({
          verseNum: v.verse,
          text: getVerseText(v, translation),
        }));
      }
      if (!sourceVerses || sourceVerses.length === 0) return [];
      return buildScriptureSlides(sourceVerses, sourceRef, translation, {
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
    livePassage,
    lookupResult,
    translation,
    pastedText,
    customRef,
    versesPerSlide,
    maxLinesPerSlide,
    includeVerseNumbers,
    includeWatermark,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const livePreviewActive = livePassage !== null && livePassage.verses.length > 0;
  const previewChapter =
    livePassage && livePassage.verses.length > 0 ? livePassage.chapter : (lookupResult.passage?.chapter ?? 0);
  const previewRef = livePassage && livePassage.verses.length > 0 ? livePassage.reference : lookupResult.resolvedRef;
  const previewVerses = livePassage && livePassage.verses.length > 0 ? livePassage.verses : lookupResult.matchedVerses;

  if (!isOpen) return null;

  const safePreviewIndex =
    generatedSlides.length === 0
      ? 0
      : Math.min(selectedPreviewIndex, generatedSlides.length - 1);
  const activeSlide = generatedSlides[safePreviewIndex];

  const resolvedTitle =
    mode === "lookup"
      ? `${livePassage && livePassage.verses.length > 0 ? livePassage.reference : lookupResult.resolvedRef} (${translation})`
      : `${customRef.trim() || "Scripture"} (${translation})`;

  const handleLookupOnline = async (overrideTranslation?: string) => {
    const ref = searchQuery.trim();
    const targetTr = overrideTranslation || translation;
    if (!ref || isOnlineLoading) return;
    setLivePassage(null);
    setIsOnlineLoading(true);
    setOnlineError(null);

    if (isTauriRuntime()) {
      try {
        const res = await bibleLookupPassage(ref, targetTr);
        const verses: VerseEntry[] = (res.verses || [])
          .filter((v) => v && typeof v.text === "string" && v.text.trim().length > 0)
          .map((v) => ({
            verse: v.verse,
            text: { KJV: v.text, WEB: v.text, ASV: v.text, [targetTr]: v.text },
          }));
        if (verses.length === 0) {
          throw new Error("No verses returned for that reference.");
        }
        const chapterNum = Number(ref.split(":").shift()?.split(" ").pop()) || 0;
        setLivePassage({
          reference: res.reference || ref,
          chapter: chapterNum,
          verses,
          source: res.source,
          copyrightNotice: res.copyrightNotice,
        });
        setSelectedPreviewIndex(0);
      } catch (err) {
        setOnlineError(
          err instanceof Error ? err.message : String(err || "Scripture lookup failed.")
        );
      } finally {
        setIsOnlineLoading(false);
      }
      return;
    }

    const controller = new AbortController();
    if (onlineAbortRef.current) {
      onlineAbortRef.current.abort();
    }
    onlineAbortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(
        `https://bible-api.com/${encodeURIComponent(ref)}?translation=${selectedTr.apiId}`,
        { signal: controller.signal }
      );
      if (!response.ok) {
        throw new Error(`Online lookup failed with status ${response.status}`);
      }
      const payload = (await response.json()) as {
        reference?: string;
        verses?: { verse?: number; text?: string }[];
      } | null;
      const verses: VerseEntry[] = Array.isArray(payload?.verses)
        ? payload.verses
            .filter((v) => v && typeof v.text === "string" && v.text.trim().length > 0)
            .map((v) => {
              const text = v.text as string;
              const verseNum = typeof v.verse === "number" ? v.verse : 0;
              return { verse: verseNum, text: { KJV: text, WEB: text, ASV: text } };
            })
        : [];
      if (verses.length === 0) {
        throw new Error("Online lookup returned no verses");
      }
      const chapterNum = Number(ref.split(":").shift()?.split(" ").pop()) || 0;
      const reference =
        typeof payload?.reference === "string" && payload.reference.trim().length > 0
          ? payload.reference.trim()
          : ref;
      setLivePassage({ reference, chapter: chapterNum, verses, source: "bible-api.com" });
      setSelectedPreviewIndex(0);
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      setOnlineError(
        aborted
          ? "Online lookup timed out after 6 seconds. Check your connection and try again."
          : "Online lookup failed. Check your connection, or use the built-in offline passages."
      );
    } finally {
      clearTimeout(timeoutId);
      if (onlineAbortRef.current === controller) {
        onlineAbortRef.current = null;
      }
      setIsOnlineLoading(false);
    }
  };

  const handleSaveProviderKey = async (kind: "esv" | "api_bible") => {
    const val = setupKeyInput.trim();
    if (!val) return;
    setSetupBusy(true);
    setSetupMessage(null);
    try {
      const updated = await bibleSaveKeys(
        kind === "esv" ? { esvApiKey: val } : { apiBibleKey: val }
      );
      if (updated.length > 0) setCatalog(updated);
      setSetupKeyInput("");
      setSetupMessage(
        kind === "esv"
          ? "Crossway ESV API key saved! Loading passage..."
          : "API.Bible key saved! Loading passage..."
      );
      void handleLookupOnline(translation);
    } catch (err) {
      setSetupMessage(String(err));
    } finally {
      setSetupBusy(false);
    }
  };

  const handleImportLocalBible = async () => {
    const path = localFileInput.trim();
    if (!path) return;
    setSetupBusy(true);
    setSetupMessage(null);
    try {
      const imported = await bibleImportLocalFile(path, translation);
      const updated = await bibleListTranslations();
      if (updated.length > 0) setCatalog(updated);
      setLocalFileInput("");
      setSetupMessage(`Imported ${imported.name} for offline use!`);
      void handleLookupOnline(imported.id);
    } catch (err) {
      setSetupMessage(String(err));
    } finally {
      setSetupBusy(false);
    }
  };

  const handleSelectQuickRef = (ref: string) => {
    setMode("lookup");
    setLivePassage(null);
    setOnlineError(null);
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
      role="dialog"
      aria-modal="true"
      aria-label="Bible Lookup and Scripture Slide Engine"
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
                Reference lookup, multi-verse reflow, and watermarked projection slides.
              </p>
              <p style={{ margin: "2px 0 0", fontSize: 11, color: "#FBBF24" }}>
                Offline passages are built-in samples — review before projecting.
              </p>
            </div>
          </div>

          {/* English Bible Translation Dropdown */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <label
              htmlFor="bible-translation-select"
              style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.05em" }}
            >
              Translation
            </label>
            <select
              id="bible-translation-select"
              aria-label="English Bible translation"
              value={translation}
              onChange={(e) => {
                const next = e.target.value as BibleTranslation;
                setTranslation(next);
                setLivePassage(null);
                setOnlineError(null);
                setSetupMessage(null);
                setSelectedPreviewIndex(0);
              }}
              style={{
                background: "#0B0F17",
                border: "1px solid #D97706",
                color: "#F8FAFC",
                borderRadius: 8,
                padding: "6px 10px",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                maxWidth: 340,
              }}
            >
              {groupedCatalog.map((grp) => (
                <optgroup key={grp.label} label={grp.label}>
                  {grp.items.map((tr) => {
                    const tag =
                      tr.provider === "local"
                        ? " [Local Offline]"
                        : tr.status === "ready"
                          ? " [Ready]"
                          : tr.status === "needs_esv_key"
                            ? " [Free ESV Key]"
                            : tr.status === "needs_api_bible_key"
                              ? " [API.Bible Key]"
                              : " [Import File]";
                    return (
                      <option key={tr.id} value={tr.id}>
                        {tr.id} — {tr.name}
                        {tag}
                      </option>
                    );
                  })}
                </optgroup>
              ))}
            </select>
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

        {/* Inline Translation Setup Banner (ESV API Key / API.Bible Key / Local File Import) */}
        {activeCatalogEntry && activeCatalogEntry.status !== "ready" && (
          <div
            style={{
              padding: "10px 12px",
              background: "rgba(30, 41, 59, 0.85)",
              border: "1px solid rgba(245, 158, 11, 0.45)",
              borderRadius: 10,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontSize: 12, color: "#FDE68A", fontWeight: 700 }}>
                {activeCatalogEntry.name} ({activeCatalogEntry.year}) —{" "}
                <span style={{ color: "#CBD5E1", fontWeight: 500 }}>{activeCatalogEntry.description}</span>
              </div>
            </div>

            {activeCatalogEntry.status === "needs_esv_key" && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Key size={14} color="#FBBF24" />
                <input
                  type="password"
                  value={setupKeyInput}
                  onChange={(e) => setSetupKeyInput(e.target.value)}
                  placeholder="Paste free Crossway ESV API token (from api.esv.org)..."
                  aria-label="Crossway ESV API token"
                  style={{
                    flex: 1,
                    minWidth: 220,
                    background: "#0B0F17",
                    border: "1px solid #334155",
                    borderRadius: 6,
                    padding: "6px 10px",
                    color: "#F8FAFC",
                    fontSize: 12,
                  }}
                />
                <button
                  type="button"
                  disabled={setupBusy || !setupKeyInput.trim()}
                  onClick={() => void handleSaveProviderKey("esv")}
                  style={{
                    background: "#D97706",
                    border: "1px solid #F59E0B",
                    color: "#FFFFFF",
                    borderRadius: 6,
                    padding: "6px 12px",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {setupBusy ? "Saving..." : "Save & Unlock ESV"}
                </button>
              </div>
            )}

            {activeCatalogEntry.status === "needs_api_bible_key" && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Key size={14} color="#38BDF8" />
                <input
                  type="password"
                  value={setupKeyInput}
                  onChange={(e) => setSetupKeyInput(e.target.value)}
                  placeholder="Paste free API.Bible key (from scripture.api.bible)..."
                  aria-label="API.Bible key"
                  style={{
                    flex: 1,
                    minWidth: 220,
                    background: "#0B0F17",
                    border: "1px solid #334155",
                    borderRadius: 6,
                    padding: "6px 10px",
                    color: "#F8FAFC",
                    fontSize: 12,
                  }}
                />
                <button
                  type="button"
                  disabled={setupBusy || !setupKeyInput.trim()}
                  onClick={() => void handleSaveProviderKey("api_bible")}
                  style={{
                    background: "#0284C7",
                    border: "1px solid #38BDF8",
                    color: "#FFFFFF",
                    borderRadius: 6,
                    padding: "6px 12px",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {setupBusy ? "Saving..." : "Save API.Bible Key"}
                </button>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Upload size={14} color="#34D399" />
              <input
                type="text"
                value={localFileInput}
                onChange={(e) => setLocalFileInput(e.target.value)}
                placeholder={`Or import local ${activeCatalogEntry.id} file path (Zefania .xml / OSIS .osis / OpenSong .xmm / .json)...`}
                aria-label="Local Bible file path"
                style={{
                  flex: 1,
                  minWidth: 220,
                  background: "#0B0F17",
                  border: "1px solid #334155",
                  borderRadius: 6,
                  padding: "6px 10px",
                  color: "#F8FAFC",
                  fontSize: 12,
                }}
              />
              <button
                type="button"
                disabled={setupBusy || !localFileInput.trim()}
                onClick={() => void handleImportLocalBible()}
                style={{
                  background: "#059669",
                  border: "1px solid #10B981",
                  color: "#FFFFFF",
                  borderRadius: 6,
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {setupBusy ? "Importing..." : `Import ${activeCatalogEntry.id} Offline`}
              </button>
            </div>

            {setupMessage && (
              <div style={{ fontSize: 11.5, color: "#6EE7B7" }}>{setupMessage}</div>
            )}
          </div>
        )}

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
              <span>Verses per slide:</span>
              <select
                value={versesPerSlide}
                onChange={(e) => {
                  setVersesPerSlide(Number(e.target.value) as 1 | 2 | 3);
                  setSelectedPreviewIndex(0);
                }}
                style={compactSelectStyle}
                aria-label="Verses per slide"
              >
                <option value={1}>1 verse (Best for Lower-Third)</option>
                <option value={2}>2 verses</option>
                <option value={3}>3 verses</option>
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
            gridTemplateColumns: "minmax(0, 1.05fr) minmax(0, 1fr)",
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
              minWidth: 0,
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
                        setLivePassage(null);
                        setSelectedPreviewIndex(0);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleLookupOnline();
                        }
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

                {/* Online Live Bible Lookup */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => void handleLookupOnline()}
                    disabled={isOnlineLoading || !searchQuery.trim()}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "7px 14px",
                      background: isOnlineLoading ? "#334155" : "#D97706",
                      border: `1px solid ${isOnlineLoading ? "#475569" : "#F59E0B"}`,
                      borderRadius: 7,
                      color: "#FFFFFF",
                      fontSize: 12.5,
                      fontWeight: 700,
                      cursor: isOnlineLoading || !searchQuery.trim() ? "not-allowed" : "pointer",
                      opacity: isOnlineLoading || !searchQuery.trim() ? 0.6 : 1,
                    }}
                  >
                    <Globe size={14} /> {isOnlineLoading ? "Looking Up Online" : "Lookup Online"}
                  </button>
                  {onlineError && (
                    <span style={{ fontSize: 11.5, color: "#F87171" }}>{onlineError}</span>
                  )}
                </div>

                {/* Popular Quick-Pick Chips */}
                <div style={{ flexShrink: 0 }}>
                  <div style={{ ...labelStyle, marginBottom: 6 }}>
                    Quick Worship & Sermon Passages (built-in samples)
                  </div>
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
                  {livePreviewActive || (lookupResult.passage && lookupResult.matchedVerses.length > 0) ? (
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
                            {previewRef}
                          </span>
                          <span style={{ fontSize: 11, color: "#94A3B8", marginLeft: 8 }}>
                            ({translation}) • {previewVerses.length} verse
                            {previewVerses.length > 1 ? "s" : ""}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const txt = previewVerses
                              .map((v) => `${v.verse} ${getVerseText(v, translation)}`)
                              .join("\n");
                            setCustomRef(previewRef);
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

                      {previewVerses.map((v) => (
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
                            {previewChapter}:{v.verse}
                          </span>
                          {getVerseText(v, translation)}
                        </div>
                      ))}

                      {!livePreviewActive && lookupResult.suggestions.length > 1 && (
                        <div style={{ marginTop: 4 }}>
                          <div style={{ ...labelStyle, marginBottom: 6 }}>
                            Built-in Sample Index: All Indexed Passages ({lookupResult.suggestions.length})
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
                    placeholder={"12 Put on therefore, as the elect of God...\n13 Forbearing one another..."}
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
              minWidth: 0,
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
