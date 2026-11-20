import React, { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Download,
  FolderOpen,
  Info,
  Key,
  Music,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { isTauriRuntime, searchSongLyrics, type LyricSearchResultItem } from "../bridge";

export interface SongLibraryResult {
  songNumber: string;
  title: string;
  author: string;
  copyright: string;
  key: string;
  lyricsPreview: string;
  themes: string[];
}

interface SongCatalogModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSong: (song: SongLibraryResult) => void;
  licenseNumber?: string;
}

type SourceFilter = "all" | "online" | "local" | "public-domain";
type SourceKind = "online" | "local" | "public-domain";

interface CatalogEntry {
  key: string;
  source: SourceKind;
  song: SongLibraryResult;
  filePath?: string;
}

interface Notice {
  kind: "info" | "error";
  text: string;
}

const LOCAL_FOLDER_STORAGE_KEY = "onering_local_song_folder";

const FILTERS: Array<{ id: SourceFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "online", label: "Online Lyrics" },
  { id: "local", label: "Local Folder" },
  { id: "public-domain", label: "Public Domain" },
];

const SOURCE_BADGE: Record<SourceKind, { label: string; background: string; color: string }> = {
  online: { label: "Online", background: "rgba(14, 165, 233, 0.18)", color: "#7DD3FC" },
  local: { label: "Local File", background: "rgba(245, 158, 11, 0.18)", color: "#FCD34D" },
  "public-domain": {
    label: "Public Domain",
    background: "rgba(16, 185, 129, 0.18)",
    color: "#6EE7B7",
  },
};

const verses = (stanzas: string[][]): string =>
  stanzas.map((lines) => lines.join("\n")).join("\n\n");

const hymn = (
  songNumber: string,
  title: string,
  author: string,
  key: string,
  lyrics: string,
  themes: string[]
): SongLibraryResult => ({
  songNumber,
  title,
  author,
  copyright: "Public Domain",
  key,
  lyricsPreview: lyrics,
  themes,
});

/**
 * Built-in offline hymnal. Every text below was first published before 1920 and is
 * Public Domain in the United States; no modern copyrighted lyrics are embedded.
 */
const PUBLIC_DOMAIN_HYMNS: SongLibraryResult[] = [
  hymn(
    "22025",
    "Amazing Grace",
    "John Newton (1779)",
    "G",
    verses([
      [
        "Amazing grace how sweet the sound",
        "That saved a wretch like me",
        "I once was lost but now am found",
        "Was blind but now I see",
      ],
      [
        "'Twas grace that taught my heart to fear",
        "And grace my fears relieved",
        "How precious did that grace appear",
        "The hour I first believed",
      ],
      [
        "Through many dangers toils and snares",
        "I have already come",
        "'Tis grace hath brought me safe thus far",
        "And grace will lead me home",
      ],
      [
        "The Lord has promised good to me",
        "His word my hope secures",
        "He will my shield and portion be",
        "As long as life endures",
      ],
      [
        "Yea when this flesh and heart shall fail",
        "And mortal life shall cease",
        "I shall possess within the veil",
        "A life of joy and peace",
      ],
      [
        "The earth shall soon dissolve like snow",
        "The sun forbear to shine",
        "But God who called me here below",
        "Will be forever mine",
      ],
    ]),
    ["Grace", "Redemption", "Hymn"]
  ),
  hymn(
    "1156",
    "Holy, Holy, Holy",
    "Reginald Heber (1826)",
    "D",
    verses([
      [
        "Holy holy holy Lord God Almighty",
        "Early in the morning our song shall rise to Thee",
        "Holy holy holy merciful and mighty",
        "God in three Persons blessed Trinity",
      ],
      [
        "Holy holy holy all the saints adore Thee",
        "Casting down their golden crowns around the glassy sea",
        "Cherubim and seraphim falling down before Thee",
        "Which wert and art and evermore shalt be",
      ],
      [
        "Holy holy holy though the darkness hide Thee",
        "Though the eye of sinful man Thy glory may not see",
        "Only Thou art holy there is none beside Thee",
        "Perfect in power in love and purity",
      ],
      [
        "Holy holy holy Lord God Almighty",
        "All Thy works shall praise Thy name in earth and sky and sea",
        "Holy holy holy merciful and mighty",
        "God in three Persons blessed Trinity",
      ],
    ]),
    ["Holiness", "Trinity", "Worship"]
  ),
  hymn(
    "30639",
    "Be Thou My Vision",
    "Traditional Irish / Eleanor Hull (1912)",
    "Eb",
    verses([
      [
        "Be Thou my Vision O Lord of my heart",
        "Naught be all else to me save that Thou art",
        "Thou my best thought by day or by night",
        "Waking or sleeping Thy presence my light",
      ],
      [
        "Be Thou my Wisdom and Thou my true Word",
        "I ever with Thee and Thou with me Lord",
        "Thou my great Father I Thy true son",
        "Thou in me dwelling and I with Thee one",
      ],
      [
        "Be Thou my breastplate my sword for the fight",
        "Be Thou my dignity Thou my delight",
        "Thou my soul's shelter and Thou my high tower",
        "Raise Thou me heavenward O Power of my power",
      ],
      [
        "Riches I heed not nor man's empty praise",
        "Thou mine inheritance now and always",
        "Thou and Thou only first in my heart",
        "High King of heaven my treasure Thou art",
      ],
      [
        "High King of heaven my victory won",
        "May I reach heaven's joys O bright heaven's Sun",
        "Heart of my own heart whatever befall",
        "Still be my Vision O Ruler of all",
      ],
    ]),
    ["Devotion", "Guidance", "Hymn"]
  ),
  hymn(
    "25376",
    "It Is Well With My Soul",
    "Horatio G. Spafford (1873)",
    "C",
    verses([
      [
        "When peace like a river attendeth my way",
        "When sorrows like sea billows roll",
        "Whatever my lot Thou hast taught me to say",
        "It is well it is well with my soul",
      ],
      [
        "Though Satan should buffet though trials should come",
        "Let this blest assurance control",
        "That Christ hath regarded my helpless estate",
        "And hath shed His own blood for my soul",
      ],
      [
        "My sin oh the bliss of this glorious thought",
        "My sin not in part but the whole",
        "Is nailed to the cross and I bear it no more",
        "Praise the Lord praise the Lord O my soul",
      ],
      [
        "And Lord haste the day when my faith shall be sight",
        "The clouds be rolled back as a scroll",
        "The trump shall resound and the Lord shall descend",
        "Even so it is well with my soul",
      ],
    ]),
    ["Peace", "Trust", "Comfort"]
  ),
  hymn(
    "108389",
    "Come, Thou Fount of Every Blessing",
    "Robert Robinson (1758)",
    "D",
    verses([
      [
        "Come Thou Fount of every blessing",
        "Tune my heart to sing Thy grace",
        "Streams of mercy never ceasing",
        "Call for songs of loudest praise",
        "Teach me some melodious sonnet",
        "Sung by flaming tongues above",
        "Praise the mount I'm fixed upon it",
        "Mount of Thy redeeming love",
      ],
      [
        "Here I raise mine Ebenezer",
        "Hither by Thy help I'm come",
        "And I hope by Thy good pleasure",
        "Safely to arrive at home",
        "Jesus sought me when a stranger",
        "Wandering from the fold of God",
        "He to rescue me from danger",
        "Interposed His precious blood",
      ],
      [
        "O to grace how great a debtor",
        "Daily I'm constrained to be",
        "Let Thy goodness like a fetter",
        "Bind my wandering heart to Thee",
        "Prone to wander Lord I feel it",
        "Prone to leave the God I love",
        "Here's my heart O take and seal it",
        "Seal it for Thy courts above",
      ],
    ]),
    ["Grace", "Praise", "Thankfulness"]
  ),
  hymn(
    "Rippon-1787",
    "How Firm a Foundation",
    "\"K\" in Rippon's Selection of Hymns (1787)",
    "G",
    verses([
      [
        "How firm a foundation ye saints of the Lord",
        "Is laid for your faith in His excellent Word",
        "What more can He say than to you He hath said",
        "To you who for refuge to Jesus have fled",
      ],
      [
        "Fear not I am with thee O be not dismayed",
        "For I am thy God and will still give thee aid",
        "I'll strengthen thee help thee and cause thee to stand",
        "Upheld by My righteous omnipotent hand",
      ],
      [
        "When through the deep waters I call thee to go",
        "The rivers of sorrow shall not overflow",
        "For I will be with thee thy trials to bless",
        "And sanctify to thee thy deepest distress",
      ],
      [
        "When through fiery trials thy pathway shall lie",
        "My grace all sufficient shall be thy supply",
        "The flame shall not hurt thee I only design",
        "Thy dross to consume and thy gold to refine",
      ],
      [
        "E'en down to old age all My people shall prove",
        "My sovereign eternal unchangeable love",
        "And when hoary hairs shall their temples adorn",
        "Like lambs they shall still in My bosom be borne",
      ],
      [
        "The soul that on Jesus hath leaned for repose",
        "I will not I will not desert to his foes",
        "That soul though all hell should endeavor to shake",
        "I'll never no never no never forsake",
      ],
    ]),
    ["Trust", "Faithfulness", "Hymn"]
  ),
  hymn(
    "Bridges-1851",
    "Crown Him With Many Crowns",
    "Matthew Bridges (1851)",
    "D",
    verses([
      [
        "Crown Him with many crowns",
        "The Lamb upon His throne",
        "Hark how the heavenly anthem drowns",
        "All music but its own",
        "Awake my soul and sing",
        "Of Him who died for thee",
        "And hail Him as thy matchless King",
        "Through all eternity",
      ],
      [
        "Crown Him the Virgin's Son",
        "The God incarnate born",
        "Whose arm those crimson trophies won",
        "Which now His brow adorn",
        "Fruit of the mystic Rose",
        "As of that Rose the Stem",
        "The Root whence mercy ever flows",
        "The Babe of Bethlehem",
      ],
      [
        "Crown Him the Lord of love",
        "Behold His hands and side",
        "Rich wounds yet visible above",
        "In beauty glorified",
        "No angel in the sky",
        "Can fully bear that sight",
        "But downward bends his burning eye",
        "At mysteries so bright",
      ],
      [
        "Crown Him the Lord of peace",
        "Whose power a scepter swayed",
        "From throne to throne in ancient times",
        "In every clime obeyed",
        "He came to earth to bring",
        "Good will and perfect peace",
        "Let every creature join to sing",
        "And hail the Prince of Peace",
      ],
      [
        "Crown Him the Lord of years",
        "The Potentate of time",
        "Creator of the rolling spheres",
        "Ineffably sublime",
        "All hail Redeemer hail",
        "For Thou hast died for me",
        "Thy praise shall never never fail",
        "Throughout eternity",
      ],
    ]),
    ["Praise", "Christ", "Worship"]
  ),
  hymn(
    "Francis-1224",
    "All Creatures of Our God and King",
    "St. Francis of Assisi (c. 1224) / William H. Draper (1906)",
    "F",
    verses([
      [
        "All creatures of our God and King",
        "Lift up your voice and with us sing",
        "Alleluia alleluia",
        "Thou burning sun with golden beam",
        "Thou silver moon with softer gleam",
        "O praise Him O praise Him",
        "Alleluia alleluia alleluia",
      ],
      [
        "Thou rushing wind that art so strong",
        "Ye clouds that sail in heaven along",
        "O praise Him alleluia",
        "Thou rising morn in praise rejoice",
        "Ye lights of evening find a voice",
        "O praise Him O praise Him",
        "Alleluia alleluia alleluia",
      ],
      [
        "Thou flowing water pure and clear",
        "Make music for thy Lord to hear",
        "Alleluia alleluia",
        "Thou fire so masterful and bright",
        "That givest man both warmth and light",
        "O praise Him O praise Him",
        "Alleluia alleluia alleluia",
      ],
      [
        "Dear mother earth who day by day",
        "Unfoldest blessings on our way",
        "O praise Him alleluia",
        "The flowers and fruits that in thee grow",
        "Let them His glory also show",
        "O praise Him O praise Him",
        "Alleluia alleluia alleluia",
      ],
      [
        "And all ye men of tender heart",
        "Forgiving others take your part",
        "O sing ye alleluia",
        "Ye who long pain and sorrow bear",
        "Praise God and on Him cast your care",
        "O praise Him O praise Him",
        "Alleluia alleluia alleluia",
      ],
      [
        "Let all things their Creator bless",
        "And worship Him in humbleness",
        "O praise Him alleluia",
        "Praise praise the Father praise the Son",
        "And praise the Spirit Three in One",
        "O praise Him O praise Him",
        "Alleluia alleluia alleluia",
      ],
    ]),
    ["Creation", "Praise", "Trinity"]
  ),
  hymn(
    "VanDyke-1907",
    "Joyful, Joyful, We Adore Thee",
    "Henry van Dyke (1907)",
    "G",
    verses([
      [
        "Joyful joyful we adore Thee",
        "God of glory Lord of love",
        "Hearts unfold like flowers before Thee",
        "Opening to the sun above",
        "Melt the clouds of sin and sadness",
        "Drive the dark of doubt away",
        "Giver of immortal gladness",
        "Fill us with the light of day",
      ],
      [
        "All Thy works with joy surround Thee",
        "Earth and heaven reflect Thy rays",
        "Stars and angels sing around Thee",
        "Center of unbroken praise",
        "Field and forest vale and mountain",
        "Flowery meadow flashing sea",
        "Chanting bird and flowing fountain",
        "Call us to rejoice in Thee",
      ],
      [
        "Thou art giving and forgiving",
        "Ever blessing ever blest",
        "Wellspring of the joy of living",
        "Ocean depth of happy rest",
        "Thou our Father Christ our Brother",
        "All who live in love are Thine",
        "Teach us how to love each other",
        "Lift us to the Joy Divine",
      ],
      [
        "Mortals join the mighty chorus",
        "Which the morning stars began",
        "Father love is reigning o'er us",
        "Brother love binds man to man",
        "Ever singing march we onward",
        "Victors in the midst of strife",
        "Joyful music leads us sunward",
        "In the triumph song of life",
      ],
    ]),
    ["Joy", "Praise", "Creation"]
  ),
  hymn(
    "Crosby-1873",
    "Blessed Assurance",
    "Fanny J. Crosby (1873)",
    "Eb",
    verses([
      [
        "Blessed assurance Jesus is mine",
        "O what a foretaste of glory divine",
        "Heir of salvation purchase of God",
        "Born of His Spirit washed in His blood",
        "This is my story this is my song",
        "Praising my Savior all the day long",
        "This is my story this is my song",
        "Praising my Savior all the day long",
      ],
      [
        "Perfect submission perfect delight",
        "Visions of rapture now burst on my sight",
        "Angels descending bring from above",
        "Echoes of mercy whispers of love",
        "This is my story this is my song",
        "Praising my Savior all the day long",
        "This is my story this is my song",
        "Praising my Savior all the day long",
      ],
      [
        "Perfect submission all is at rest",
        "I in my Savior am happy and blest",
        "Watching and waiting looking above",
        "Filled with His goodness lost in His love",
        "This is my story this is my song",
        "Praising my Savior all the day long",
        "This is my story this is my song",
        "Praising my Savior all the day long",
      ],
    ]),
    ["Assurance", "Praise", "Hymn"]
  ),
  hymn(
    "Toplady-1775",
    "Rock of Ages",
    "Augustus M. Toplady (1775)",
    "G",
    verses([
      [
        "Rock of Ages cleft for me",
        "Let me hide myself in Thee",
        "Let the water and the blood",
        "From Thy wounded side which flowed",
        "Be of sin the double cure",
        "Cleanse me from its guilt and power",
      ],
      [
        "Not the labor of my hands",
        "Can fulfill Thy law's demands",
        "Could my zeal no respite know",
        "Could my tears forever flow",
        "All for sin could not atone",
        "Thou must save and Thou alone",
      ],
      [
        "Nothing in my hand I bring",
        "Simply to Thy cross I cling",
        "Naked come to Thee for dress",
        "Helpless look to Thee for grace",
        "Foul I to the fountain fly",
        "Wash me Savior or I die",
      ],
      [
        "While I draw this fleeting breath",
        "When mine eyes shall close in death",
        "When I soar to worlds unknown",
        "See Thee on Thy judgment throne",
        "Rock of Ages cleft for me",
        "Let me hide myself in Thee",
      ],
    ]),
    ["Atonement", "Refuge", "Hymn"]
  ),
  hymn(
    "Scriven-1855",
    "What a Friend We Have in Jesus",
    "Joseph M. Scriven (1855)",
    "Eb",
    verses([
      [
        "What a Friend we have in Jesus",
        "All our sins and griefs to bear",
        "What a privilege to carry",
        "Everything to God in prayer",
        "O what peace we often forfeit",
        "O what needless pain we bear",
        "All because we do not carry",
        "Everything to God in prayer",
      ],
      [
        "Have we trials and temptations",
        "Is there trouble anywhere",
        "We should never be discouraged",
        "Take it to the Lord in prayer",
        "Can we find a friend so faithful",
        "Who will all our sorrows share",
        "Jesus knows our every weakness",
        "Take it to the Lord in prayer",
      ],
      [
        "Are we weak and heavy laden",
        "Cumbered with a load of care",
        "Precious Savior still our refuge",
        "Take it to the Lord in prayer",
        "Do thy friends despise forsake thee",
        "Take it to the Lord in prayer",
        "In His arms He'll take and shield thee",
        "Thou wilt find a solace there",
      ],
    ]),
    ["Friendship", "Prayer", "Comfort"]
  ),
  hymn(
    "German-1600s",
    "Fairest Lord Jesus",
    "Traditional German hymn (17th century) / English version (1902)",
    "G",
    verses([
      [
        "Fairest Lord Jesus",
        "Ruler of all nature",
        "O Thou of God and Father the Son",
        "Who though to heaven art gone",
        "Thou still art here with us",
        "Forever the same",
        "Fairest Lord Jesus",
        "Lord of all creation",
        "Fairest of all the sons of men",
        "Jesus my Lord my God my all",
      ],
      [
        "Fair are the meadows",
        "Fairer still the woodlands",
        "Robed in the blooming garb of spring",
        "Jesus is fairer",
        "Jesus is purer",
        "Who makes the woeful heart to sing",
      ],
      [
        "Fair is the sunshine",
        "Fairer still the moonlight",
        "And all the twinkling starry host",
        "Jesus shines brighter",
        "Jesus shines purer",
        "Than all the angels heaven can boast",
      ],
    ]),
    ["Beauty", "Creation", "Christ"]
  ),
  hymn(
    "Luther-1529",
    "A Mighty Fortress Is Our God",
    "Martin Luther (1529) / Frederick H. Hedge (1853)",
    "D",
    verses([
      [
        "A mighty fortress is our God",
        "A bulwark never failing",
        "Our helper He amid the flood",
        "Of mortal ills prevailing",
        "For still our ancient foe",
        "Doth seek to work us woe",
        "His craft and power are great",
        "And armed with cruel hate",
        "On earth is not his equal",
      ],
      [
        "Did we in our own strength confide",
        "Our striving would be losing",
        "Were not the right Man on our side",
        "The Man of God's own choosing",
        "Dost ask who that may be",
        "Christ Jesus it is He",
        "Lord Sabaoth His name",
        "From age to age the same",
        "And He must win the battle",
      ],
      [
        "And though this world with devils filled",
        "Should threaten to undo us",
        "We will not fear for God hath willed",
        "His truth to triumph through us",
        "The prince of darkness grim",
        "We tremble not for him",
        "His rage we can endure",
        "For lo his doom is sure",
        "One little word shall fell him",
      ],
      [
        "That word above all earthly powers",
        "No thanks to them abideth",
        "The Spirit and the gifts are ours",
        "Through Him who with us sideth",
        "Let goods and kindred go",
        "This mortal life also",
        "The body they may kill",
        "God's truth abideth still",
        "His kingdom is forever",
      ],
    ]),
    ["Protection", "Faith", "Hymn"]
  ),
  hymn(
    "Ken-1674",
    "Doxology",
    "Thomas Ken (1674)",
    "G",
    verses([
      [
        "Praise God from whom all blessings flow",
        "Praise Him all creatures here below",
        "Praise Him above ye heavenly host",
        "Praise Father Son and Holy Ghost",
      ],
    ]),
    ["Praise", "Trinity", "Doxology"]
  ),
];

function matchesTerm(song: SongLibraryResult, term: string): boolean {
  return (
    song.title.toLowerCase().includes(term) ||
    song.author.toLowerCase().includes(term) ||
    song.songNumber.toLowerCase().includes(term) ||
    song.themes.some((theme) => theme.toLowerCase().includes(term)) ||
    song.lyricsPreview.toLowerCase().includes(term)
  );
}

function cleanLyrics(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => !/^\s*\[(?:\d{1,2}:|[a-z]{2,3}\s*:)/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function countStanzas(lyrics: string): number {
  const text = lyrics.trim();
  return text ? text.split(/\n\s*\n/).filter((part) => part.trim()).length : 0;
}

function countLines(lyrics: string): number {
  const text = lyrics.trim();
  return text ? text.split("\n").filter((line) => line.trim()).length : 0;
}

function entryFromLyricItem(
  item: LyricSearchResultItem,
  fallbackSource: SourceKind
): CatalogEntry | null {
  const lyrics = cleanLyrics(item.lyrics);
  const title = typeof item.title === "string" ? item.title.trim() : "";
  if (!title && !lyrics) return null;

  const rawSource = typeof item.source === "string" ? item.source.toLowerCase() : "";
  const source: SourceKind =
    rawSource.includes("local") || rawSource.includes("file")
      ? "local"
      : rawSource.includes("public") || rawSource.includes("hymn")
        ? "public-domain"
        : fallbackSource;

  const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : `${source}-${title}`;
  const filePath = typeof item.filePath === "string" ? item.filePath.trim() : "";

  return {
    key: `${source}-${id}`,
    source,
    filePath: filePath || undefined,
    song: {
      songNumber: id,
      title: title || "Untitled song",
      author: typeof item.artist === "string" && item.artist.trim() ? item.artist.trim() : "Unknown author",
      copyright:
        typeof item.copyright === "string" && item.copyright.trim()
          ? item.copyright.trim()
          : "Not specified by source",
      key: typeof item.key === "string" && item.key.trim() ? item.key.trim() : "—",
      lyricsPreview: lyrics,
      themes: Array.isArray(item.themes) ? item.themes.filter((theme) => typeof theme === "string") : [],
    },
  };
}

async function collectEntries(
  term: string,
  filter: SourceFilter,
  localFolder: string
): Promise<{ entries: CatalogEntry[]; notice: Notice | null }> {
  const entries: CatalogEntry[] = [];
  const notices: Notice[] = [];
  const wantsPublicDomain = filter === "all" || filter === "public-domain";
  const wantsOnline = filter === "all" || filter === "online";
  const wantsLocal = filter === "all" || filter === "local";

  if (wantsPublicDomain) {
    for (const song of PUBLIC_DOMAIN_HYMNS) {
      if (matchesTerm(song, term)) {
        entries.push({ key: `pd-${song.songNumber}`, source: "public-domain", song });
      }
    }
  }

  if (wantsOnline) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      notices.push({
        kind: "info",
        text: "You appear to be offline. Online lyrics are unavailable; built-in hymns still work.",
      });
    } else {
      try {
        const remote = await searchSongLyrics(term, undefined, true);
        for (const item of remote) {
          const entry = entryFromLyricItem(item, "online");
          if (entry && matchesTerm(entry.song, term)) entries.push(entry);
        }
        if (remote.length === 0) {
          notices.push({
            kind: "info",
            text: "No online matches returned. Check the connection or try a different phrase.",
          });
        }
      } catch {
        notices.push({
          kind: "error",
          text: "Online lyric search could not be reached. Built-in hymns remain available.",
        });
      }
    }
  }

  if (wantsLocal) {
    const folder = localFolder.trim();
    if (!folder) {
      notices.push({
        kind: "info",
        text: "Set a local song folder below to search offline .txt / .cho / .xml files.",
      });
    } else if (!isTauriRuntime()) {
      notices.push({
        kind: "info",
        text: "Local folder scanning requires the installed app; this browser preview has no filesystem access.",
      });
    } else {
      try {
        const local = await searchSongLyrics(term, folder, false);
        for (const item of local) {
          const entry = entryFromLyricItem(item, "local");
          if (entry && matchesTerm(entry.song, term)) entries.push(entry);
        }
        if (local.length === 0) {
          notices.push({ kind: "info", text: "No local-song matches for this search in the configured folder." });
        }
      } catch {
        notices.push({ kind: "error", text: "The configured local song folder could not be searched." });
      }
    }
  }

  const notice = notices.find((candidate) => candidate.kind === "error") ?? notices[0] ?? null;
  return { entries, notice };
}

export const SongCatalogModal: React.FC<SongCatalogModalProps> = ({
  isOpen,
  onClose,
  onImportSong,
  licenseNumber = "Not Configured",
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SourceFilter>("all");
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [importedKeys, setImportedKeys] = useState<Set<string>>(new Set());
  const [isSearching, setIsSearching] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [folderExpanded, setFolderExpanded] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [localFolder, setLocalFolder] = useState(() => {
    try {
      return localStorage.getItem(LOCAL_FOLDER_STORAGE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const localFolderRef = useRef(localFolder);

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

  useEffect(() => {
    if (!isOpen || !query) {
      setEntries([]);
      setSelectedKey(null);
      setNotice(null);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    setIsSearching(true);
    setNotice(null);
    void (async () => {
      try {
        const next = await collectEntries(query, filter, localFolderRef.current);
        if (cancelled) return;
        setEntries(next.entries);
        setNotice(next.notice);
        setSelectedKey((current) =>
          next.entries.some((entry) => entry.key === current) ? current : next.entries[0]?.key ?? null
        );
        setIsSearching(false);
      } catch {
        if (cancelled) return;
        setEntries([]);
        setSelectedKey(null);
        setNotice({ kind: "error", text: "The song search could not be completed." });
        setIsSearching(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, query, filter, refreshToken]);

  if (!isOpen) return null;

  const updateLocalFolder = (value: string) => {
    setLocalFolder(value);
    localFolderRef.current = value;
    try {
      localStorage.setItem(LOCAL_FOLDER_STORAGE_KEY, value);
    } catch {
      // Restricted webviews may block storage; the in-memory value still works for this session.
    }
  };

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = searchTerm.trim();
    setQuery(trimmed);
    if (!trimmed) {
      setSearchTerm("");
      setEntries([]);
      setSelectedKey(null);
      setNotice(null);
    }
  };

  const handleImport = (entry: CatalogEntry) => {
    onImportSong(entry.song);
    setImportedKeys(new Set([...importedKeys, entry.key]));
  };

  const selectedEntry = entries.find((entry) => entry.key === selectedKey) ?? null;
  const badge = (source: SourceKind) => SOURCE_BADGE[source];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Song and Lyric Search"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(4px)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        boxSizing: "border-box",
      }}
    >
      <div
        className="card"
        style={{
          width: "100%",
          maxWidth: 900,
          boxSizing: "border-box",
          margin: "16px",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          borderRadius: 14,
          overflow: "hidden",
          border: "1px solid #374151",
          background: "#111827",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid #1F2937",
            backgroundColor: "#182234",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Music size={22} color="#38BDF8" />
            <div>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#F9FAFB" }}>
                Song &amp; Lyric Search
              </h2>
              <span className="mono" style={{ fontSize: 12, color: "#9CA3AF" }}>
                Online index · local song folder · built-in public-domain hymnal
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close song and lyric search"
            className="btn"
            style={{ padding: "6px 8px", background: "transparent", border: "none" }}
          >
            <X size={20} color="#9CA3AF" />
          </button>
        </div>

        {/* Search bar + source filters */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #1F2937", background: "#131C2E" }}>
          <form onSubmit={handleSearch} style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
              <Search
                size={18}
                color="#9CA3AF"
                style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}
              />
              <input
                type="text"
                placeholder="Search song title, author, or any lyric phrase..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                style={{
                  width: "100%",
                  height: 42,
                  paddingLeft: 38,
                  paddingRight: 12,
                  borderRadius: 8,
                  backgroundColor: "#1F2937",
                  border: "1px solid #374151",
                  color: "#F9FAFB",
                  fontSize: 14,
                  outline: "none",
                }}
              />
            </div>
            <button
              type="submit"
              disabled={isSearching}
              className="btn"
              style={{
                height: 42,
                padding: "0 20px",
                backgroundColor: "#0284C7",
                borderColor: "#0369A1",
                color: "#FFFFFF",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {isSearching ? <RefreshCw size={16} className="animate-spin" /> : <Search size={16} />}
              Search
            </button>
          </form>

          <div
            role="group"
            aria-label="Search source filter"
            style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}
          >
            {FILTERS.map((option) => {
              const active = filter === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setFilter(option.id)}
                  aria-pressed={active}
                  className="btn"
                  style={{
                    height: 30,
                    padding: "0 12px",
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    backgroundColor: active ? "#0369A1" : "#1F2937",
                    border: `1px solid ${active ? "#38BDF8" : "#374151"}`,
                    color: active ? "#F0F9FF" : "#9CA3AF",
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          {/* Compact, collapsible local folder configuration (non-secret path only) */}
          <div style={{ marginTop: 12, borderTop: "1px solid #1F2937", paddingTop: 10 }}>
            <button
              type="button"
              onClick={() => setFolderExpanded((value) => !value)}
              aria-expanded={folderExpanded}
              className="btn"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: 0,
                background: "transparent",
                border: "none",
                color: "#9CA3AF",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {folderExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              <FolderOpen size={14} color="#38BDF8" />
              Local Song Folder (Offline .txt / .cho / .xml)
              <span className="mono" style={{ color: localFolder.trim() ? "#6EE7B7" : "#6B7280" }}>
                {localFolder.trim() ? "configured" : "not set"}
              </span>
            </button>
            {folderExpanded && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <input
                  type="text"
                  value={localFolder}
                  onChange={(event) => updateLocalFolder(event.target.value)}
                  placeholder="Folder path on this computer (stored locally, no credentials)"
                  aria-label="Local song folder path"
                  style={{
                    flex: 1,
                    minWidth: 220,
                    height: 36,
                    padding: "0 10px",
                    borderRadius: 6,
                    backgroundColor: "#1F2937",
                    border: "1px solid #374151",
                    color: "#F9FAFB",
                    fontSize: 12,
                  }}
                />
                <button
                  type="button"
                  onClick={() => setRefreshToken((value) => value + 1)}
                  className="btn"
                  style={{ height: 36, padding: "0 14px", fontSize: 12 }}
                >
                  Apply folder
                </button>
              </div>
            )}
          </div>

          {/* Honest progress / offline / error messaging */}
          {isSearching && (
            <div
              role="status"
              aria-live="polite"
              style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, color: "#7DD3FC", fontSize: 12 }}
            >
              <RefreshCw size={13} className="animate-spin" /> Searching selected sources...
            </div>
          )}
          {!isSearching && notice && (
            <div
              role={notice.kind === "error" ? "alert" : "status"}
              aria-live={notice.kind === "error" ? "assertive" : "polite"}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                marginTop: 10,
                color: notice.kind === "error" ? "#FCA5A5" : "#FCD34D",
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {notice.kind === "error" ? <AlertCircle size={14} /> : <Info size={14} />}
              <span>{notice.text}</span>
            </div>
          )}
        </div>

        {/* Content Body */}
        <div
          style={{
            display: "flex",
            flex: 1,
            minHeight: "min(400px, 45vh)",
            flexShrink: 1,
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          {/* Results List */}
          <div
            style={{
              width: "48%",
              minWidth: 0,
              borderRight: "1px solid #1F2937",
              overflowY: "auto",
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {entries.length === 0 && !isSearching ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                  color: "#6B7280",
                  textAlign: "center",
                  padding: 24,
                }}
              >
                <Music size={36} style={{ marginBottom: 12, opacity: 0.5 }} />
                <p style={{ margin: 0, fontSize: 14 }}>
                  {query
                    ? "No matching songs. Try another title, author, or lyric phrase."
                    : "Type a title, author, or lyric phrase above to search."}
                </p>
              </div>
            ) : (
              entries.map((entry) => {
                const isSelected = selectedKey === entry.key;
                const isImported = importedKeys.has(entry.key);
                const sourceBadge = badge(entry.source);
                return (
                  <button
                    type="button"
                    key={entry.key}
                    onClick={() => setSelectedKey(entry.key)}
                    aria-pressed={isSelected}
                    style={{
                      padding: "12px 14px",
                      borderRadius: 8,
                      backgroundColor: isSelected ? "#1E3A8A" : "#1F2937",
                      border: `1px solid ${isSelected ? "#3B82F6" : "#374151"}`,
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                      textAlign: "left",
                      width: "100%",
                      font: "inherit",
                      color: "inherit",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 15, color: "#F9FAFB" }}>{entry.song.title}</span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 800,
                          letterSpacing: "0.06em",
                          padding: "2px 6px",
                          borderRadius: 4,
                          backgroundColor: sourceBadge.background,
                          color: sourceBadge.color,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {sourceBadge.label}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: "#D1D5DB", marginTop: 4 }}>{entry.song.author}</div>
                    {entry.filePath && (
                      <div className="mono" style={{ fontSize: 11, color: "#9CA3AF", marginTop: 4, wordBreak: "break-all" }}>
                        {entry.filePath}
                      </div>
                    )}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        marginTop: 8,
                        fontSize: 12,
                        color: "#9CA3AF",
                      }}
                    >
                      <span className="mono" style={{ fontSize: 11 }}>#{entry.song.songNumber}</span>
                      <span>Key: {entry.song.key}</span>
                      <span>{countStanzas(entry.song.lyricsPreview)} stanzas</span>
                      {isImported && (
                        <span style={{ color: "#34D399", display: "flex", alignItems: "center", gap: 4 }}>
                          <CheckCircle size={12} /> Imported
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Song Preview Details */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              padding: 20,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {selectedEntry ? (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <h3 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: "#F9FAFB" }}>
                      {selectedEntry.song.title}
                    </h3>
                    <div style={{ fontSize: 13, color: "#9CA3AF", marginTop: 4 }}>
                      By {selectedEntry.song.author}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleImport(selectedEntry)}
                    disabled={importedKeys.has(selectedEntry.key)}
                    className="btn"
                    style={{
                      height: 40,
                      padding: "0 16px",
                      flexShrink: 0,
                      backgroundColor: importedKeys.has(selectedEntry.key) ? "#065F46" : "#0284C7",
                      borderColor: importedKeys.has(selectedEntry.key) ? "#059669" : "#0369A1",
                      color: "#FFFFFF",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    {importedKeys.has(selectedEntry.key) ? (
                      <>
                        <CheckCircle size={16} /> Added to Library
                      </>
                    ) : (
                      <>
                        <Download size={16} /> Import to Service
                      </>
                    )}
                  </button>
                </div>

                <div
                  className="mono"
                  style={{
                    margin: "16px 0",
                    padding: "10px 14px",
                    borderRadius: 6,
                    backgroundColor: "#182234",
                    border: "1px solid #1E293B",
                    fontSize: 12,
                    color: "#94A3B8",
                  }}
                >
                  <div>ID: {selectedEntry.song.songNumber}</div>
                  <div>Copyright: {selectedEntry.song.copyright}</div>
                  <div>Original Key: {selectedEntry.song.key}</div>
                  <div>
                    Source: {badge(selectedEntry.source).label}
                    {selectedEntry.filePath ? ` — ${selectedEntry.filePath}` : ""}
                  </div>
                </div>

                <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#9CA3AF", marginBottom: 8 }}>
                    LYRICS PREVIEW · {countStanzas(selectedEntry.song.lyricsPreview)} stanzas ·{" "}
                    {countLines(selectedEntry.song.lyricsPreview)} lines
                  </span>
                  <div
                    style={{
                      flex: 1,
                      minHeight: 0,
                      padding: 14,
                      borderRadius: 8,
                      backgroundColor: "#1F2937",
                      border: "1px solid #374151",
                      whiteSpace: "pre-line",
                      overflowY: "auto",
                      fontSize: 14,
                      lineHeight: "1.6",
                      color: "#F3F4F6",
                      fontFamily: "inherit",
                    }}
                  >
                    {selectedEntry.song.lyricsPreview || "No lyrics supplied by this source."}
                  </div>
                </div>
              </>
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                  color: "#6B7280",
                  textAlign: "center",
                  padding: 24,
                }}
              >
                Select a song on the left to preview the full lyrics and source details.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid #1F2937",
            backgroundColor: "#182234",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, color: "#9CA3AF", fontSize: 12 }}>
            <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Online lyric search powered by open LRCLIB index. Ensure your organization holds appropriate
              display licenses for copyrighted works.
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close song and lyric search"
            className="btn"
            style={{ height: 36, padding: "0 16px", flexShrink: 0 }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
