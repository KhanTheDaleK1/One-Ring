//! Multi-provider Scripture engine supporting:
//! 1. Local offline Bible files (Zefania XML, OSIS XML, OpenSong XML, JSON)
//! 2. Official publisher APIs (Crossway ESV API, American Bible Society API.Bible) via user-supplied keys
//! 3. Open-license / Public-Domain online Scripture APIs (`bible.helloao.org`, `bible-api.com`)
//!
//! Zero copyrighted Scripture text is embedded in this repository.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BibleTranslationInfo {
    pub id: String,
    pub name: String,
    pub year: String,
    pub category: String,
    pub category_label: String,
    pub description: String,
    /// "ready" | "needs_esv_key" | "needs_api_bible_key" | "needs_local_file"
    pub status: String,
    /// "local" | "open_online" | "esv_api" | "api_bible" | "local_import"
    pub provider: String,
    pub local_file_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BibleVerse {
    pub verse: u32,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BiblePassageResult {
    pub reference: String,
    pub translation_id: String,
    pub translation_name: String,
    pub source: String,
    pub copyright_notice: String,
    pub verses: Vec<BibleVerse>,
}

#[derive(Debug, Clone)]
pub struct BibleProviderConfig {
    pub esv_api_key: String,
    pub api_bible_key: String,
    pub local_bibles_dir: String,
}

struct CatalogEntry {
    id: &'static str,
    name: &'static str,
    year: &'static str,
    category: &'static str,
    category_label: &'static str,
    description: &'static str,
    helloao_id: Option<&'static str>,
    bible_api_id: Option<&'static str>,
    default_provider: &'static str,
    api_bible_abbrev: Option<&'static str>,
}

const CATALOG: &[CatalogEntry] = &[
    // 1. Word-for-Word (Literal / Formal Equivalence)
    CatalogEntry {
        id: "KJV",
        name: "King James Version (KJV / AV)",
        year: "1611 / 1769",
        category: "word_for_word",
        category_label: "1. Word-for-Word (Literal)",
        description: "Classic literary translation from the Textus Receptus.",
        helloao_id: Some("eng_kjv"),
        bible_api_id: Some("kjv"),
        default_provider: "open",
        api_bible_abbrev: Some("KJV"),
    },
    CatalogEntry {
        id: "NKJV",
        name: "New King James Version (NKJV)",
        year: "1982",
        category: "word_for_word",
        category_label: "1. Word-for-Word (Literal)",
        description: "Modern English update of the KJV Textus Receptus tradition.",
        helloao_id: None,
        bible_api_id: None,
        default_provider: "local",
        api_bible_abbrev: Some("NKJV"),
    },
    CatalogEntry {
        id: "NASB",
        name: "New American Standard Bible (NASB 1995 / 2020)",
        year: "1971 / 1995 / 2020",
        category: "word_for_word",
        category_label: "1. Word-for-Word (Literal)",
        description: "Strictly literal modern English translation for study and preaching.",
        helloao_id: None,
        bible_api_id: None,
        default_provider: "local",
        api_bible_abbrev: Some("NASB"),
    },
    CatalogEntry {
        id: "LSB",
        name: "Legacy Standard Bible (LSB)",
        year: "2021",
        category: "word_for_word",
        category_label: "1. Word-for-Word (Literal)",
        description: "Revision of the 1995 NASB rendering YHWH as Yahweh and doulos as slave.",
        helloao_id: None,
        bible_api_id: None,
        default_provider: "local",
        api_bible_abbrev: Some("LSB"),
    },
    CatalogEntry {
        id: "ESV",
        name: "English Standard Version (ESV)",
        year: "2001 / 2016",
        category: "word_for_word",
        category_label: "1. Word-for-Word (Literal)",
        description: "Balances word-for-word accuracy with smooth modern English (free Crossway API key or local file).",
        helloao_id: None,
        bible_api_id: None,
        default_provider: "esv_api",
        api_bible_abbrev: Some("ESV"),
    },
    CatalogEntry {
        id: "RSV",
        name: "Revised Standard Version (RSV)",
        year: "1952",
        category: "word_for_word",
        category_label: "1. Word-for-Word (Literal)",
        description: "Classic academic formal-equivalence revision.",
        helloao_id: None,
        bible_api_id: None,
        default_provider: "api_bible",
        api_bible_abbrev: Some("RSV"),
    },
    CatalogEntry {
        id: "NRSV",
        name: "New Revised Standard Version (NRSV / NRSVue)",
        year: "1989 / 2021",
        category: "word_for_word",
        category_label: "1. Word-for-Word (Literal)",
        description: "Academic standard used across universities and mainline denominations.",
        helloao_id: None,
        bible_api_id: None,
        default_provider: "api_bible",
        api_bible_abbrev: Some("NRSV"),
    },
    CatalogEntry {
        id: "CSB",
        name: "Christian Standard Bible (CSB)",
        year: "2017",
        category: "word_for_word",
        category_label: "1. Word-for-Word (Literal)",
        description: "Optimal Equivalence update to the HCSB balancing fidelity and readability.",
        helloao_id: None,
        bible_api_id: None,
        default_provider: "local",
        api_bible_abbrev: Some("CSB"),
    },
    CatalogEntry {
        id: "YLT",
        name: "Young's Literal Translation (YLT)",
        year: "1862",
        category: "word_for_word",
        category_label: "1. Word-for-Word (Literal)",
        description: "Ultra-literal translation mirroring Hebrew and Greek verb tenses.",
        helloao_id: None,
        bible_api_id: Some("ylt"),
        default_provider: "open",
        api_bible_abbrev: Some("YLT"),
    },
    CatalogEntry {
        id: "AMP",
        name: "Amplified Bible (AMP)",
        year: "1965 / 2015",
        category: "word_for_word",
        category_label: "1. Word-for-Word (Literal)",
        description: "Uses inline brackets and parentheses for alternate Greek/Hebrew nuances.",
        helloao_id: None,
        bible_api_id: None,
        default_provider: "local",
        api_bible_abbrev: Some("AMP"),
    },
    CatalogEntry {
        id: "BSB",
        name: "Berean Standard Bible (BSB)",
        year: "2023",
        category: "word_for_word",
        category_label: "1. Word-for-Word (Literal)",
        description: "Modern public-domain literal-readable English translation.",
        helloao_id: Some("BSB"),
        bible_api_id: Some("web"),
        default_provider: "open",
        api_bible_abbrev: Some("BSB"),
    },
    CatalogEntry {
        id: "LSV",
        name: "Literal Standard Version (LSV)",
        year: "2020",
        category: "word_for_word",
        category_label: "1. Word-for-Word (Literal)",
        description: "Modern open-license literal update of Young's Literal Translation.",
        helloao_id: Some("eng_lsv"),
        bible_api_id: None,
        default_provider: "open",
        api_bible_abbrev: Some("LSV"),
    },
    CatalogEntry {
        id: "LEB",
        name: "Lexham English Bible (LEB)",
        year: "2012",
        category: "word_for_word",
        category_label: "1. Word-for-Word (Literal)",
        description: "Modern literal translation from original languages (open license).",
        helloao_id: Some("eng_leb"),
        bible_api_id: None,
        default_provider: "open",
        api_bible_abbrev: Some("LEB"),
    },

    // 2. Thought-for-Thought (Dynamic / Functional Equivalence)
    CatalogEntry {
        id: "NIV",
        name: "New International Version (NIV)",
        year: "1978 / 1984 / 2011",
        category: "thought_for_thought",
        category_label: "2. Thought-for-Thought (Dynamic)",
        description: "Balanced modern English translation (import local licensed file).",
        helloao_id: None,
        bible_api_id: None,
        default_provider: "local",
        api_bible_abbrev: Some("NIV"),
    },
    CatalogEntry {
        id: "NLT",
        name: "New Living Translation (NLT)",
        year: "1996 / 2015",
        category: "thought_for_thought",
        category_label: "2. Thought-for-Thought (Dynamic)",
        description: "Clear, natural contemporary English from original languages (import local file).",
        helloao_id: None,
        bible_api_id: None,
        default_provider: "local",
        api_bible_abbrev: Some("NLT"),
    },
    CatalogEntry {
        id: "NET",
        name: "New English Translation (NET)",
        year: "2005",
        category: "thought_for_thought",
        category_label: "2. Thought-for-Thought (Dynamic)",
        description: "Digital-first scholarly translation with extensive translator notes.",
        helloao_id: Some("eng_net"),
        bible_api_id: None,
        default_provider: "open",
        api_bible_abbrev: Some("NET"),
    },
    CatalogEntry {
        id: "GNT",
        name: "Good News Translation (GNT / TEV)",
        year: "1976",
        category: "thought_for_thought",
        category_label: "2. Thought-for-Thought (Dynamic)",
        description: "Accessible, everyday English translation (free API.Bible key or local file).",
        helloao_id: None,
        bible_api_id: None,
        default_provider: "api_bible",
        api_bible_abbrev: Some("GNT"),
    },
    CatalogEntry {
        id: "CEV",
        name: "Contemporary English Version (CEV)",
        year: "1995",
        category: "thought_for_thought",
        category_label: "2. Thought-for-Thought (Dynamic)",
        description: "Designed specifically to be read aloud clearly (free API.Bible key or local file).",
        helloao_id: None,
        bible_api_id: None,
        default_provider: "api_bible",
        api_bible_abbrev: Some("CEV"),
    },
    CatalogEntry {
        id: "GW",
        name: "God's Word Translation (GW)",
        year: "1995",
        category: "thought_for_thought",
        category_label: "2. Thought-for-Thought (Dynamic)",
        description: "Closest natural equivalence avoiding traditional jargon (import local file).",
        helloao_id: None,
        bible_api_id: None,
        default_provider: "local",
        api_bible_abbrev: Some("GW"),
    },
    CatalogEntry {
        id: "WEB",
        name: "World English Bible (WEB)",
        year: "2000",
        category: "thought_for_thought",
        category_label: "2. Thought-for-Thought (Dynamic)",
        description: "Modern public-domain English translation ready offline & online.",
        helloao_id: Some("ENGWEBP"),
        bible_api_id: Some("web"),
        default_provider: "open",
        api_bible_abbrev: Some("WEB"),
    },

    // 3. Paraphrases
    CatalogEntry {
        id: "MSG",
        name: "The Message (MSG)",
        year: "2002",
        category: "paraphrase",
        category_label: "3. Paraphrases",
        description: "Eugene Peterson's conversational contemporary idiom (import local file).",
        helloao_id: None,
        bible_api_id: None,
        default_provider: "local",
        api_bible_abbrev: Some("MSG"),
    },
    CatalogEntry {
        id: "TLB",
        name: "The Living Bible (TLB)",
        year: "1971",
        category: "paraphrase",
        category_label: "3. Paraphrases",
        description: "Kenneth Taylor's devotional paraphrase of the 1901 ASV (import local file).",
        helloao_id: None,
        bible_api_id: None,
        default_provider: "local",
        api_bible_abbrev: Some("TLB"),
    },
    CatalogEntry {
        id: "TPT",
        name: "The Passion Translation (TPT)",
        year: "2017",
        category: "paraphrase",
        category_label: "3. Paraphrases",
        description: "Expanded devotional paraphrase (import local file).",
        helloao_id: None,
        bible_api_id: None,
        default_provider: "local",
        api_bible_abbrev: Some("TPT"),
    },
    CatalogEntry {
        id: "PHILLIPS",
        name: "J.B. Phillips New Testament",
        year: "1958",
        category: "paraphrase",
        category_label: "3. Paraphrases",
        description: "Classic British paraphrase of the New Testament (import local file).",
        helloao_id: None,
        bible_api_id: None,
        default_provider: "local",
        api_bible_abbrev: Some("PHILLIPS"),
    },

    // 4. Catholic & Orthodox Canons
    CatalogEntry {
        id: "DRB",
        name: "Douay-Rheims Bible (DRB)",
        year: "1582 / 1609 / 1750s",
        category: "catholic_orthodox",
        category_label: "4. Catholic & Orthodox Canons",
        description: "Classic Catholic 73-book translation from the Latin Vulgate (Challoner revision).",
        helloao_id: Some("eng_dra"),
        bible_api_id: Some("dra"),
        default_provider: "open",
        api_bible_abbrev: Some("DRA"),
    },
    CatalogEntry {
        id: "NABRE",
        name: "New American Bible Revised Edition (NABRE)",
        year: "2011",
        category: "catholic_orthodox",
        category_label: "4. Catholic & Orthodox Canons",
        description: "Official US Catholic liturgical translation (API.Bible key or local file).",
        helloao_id: None,
        bible_api_id: None,
        default_provider: "api_bible",
        api_bible_abbrev: Some("NABRE"),
    },
    CatalogEntry {
        id: "RSVCE",
        name: "Revised Standard Version - Catholic Edition (RSV-CE / RSV-2CE)",
        year: "1966 / 2006",
        category: "catholic_orthodox",
        category_label: "4. Catholic & Orthodox Canons",
        description: "Formal RSV accuracy with the 73-book Catholic canon (import local file).",
        helloao_id: None,
        bible_api_id: None,
        default_provider: "local",
        api_bible_abbrev: Some("RSVCE"),
    },
    CatalogEntry {
        id: "NJB",
        name: "New Jerusalem Bible (NJB / RNJB)",
        year: "1985 / 2019",
        category: "catholic_orthodox",
        category_label: "4. Catholic & Orthodox Canons",
        description: "Literary Catholic translation (import local file).",
        helloao_id: None,
        bible_api_id: None,
        default_provider: "local",
        api_bible_abbrev: Some("NJB"),
    },
    CatalogEntry {
        id: "OSB",
        name: "Orthodox Study Bible (OSB)",
        year: "2008",
        category: "catholic_orthodox",
        category_label: "4. Catholic & Orthodox Canons",
        description: "Eastern Orthodox canon with LXX Old Testament and NKJV NT (import local file).",
        helloao_id: None,
        bible_api_id: None,
        default_provider: "local",
        api_bible_abbrev: Some("OSB"),
    },
    CatalogEntry {
        id: "WEBC",
        name: "World English Bible - Catholic Canon (73 Books)",
        year: "2000",
        category: "catholic_orthodox",
        category_label: "4. Catholic & Orthodox Canons",
        description: "Modern public-domain 73-book Catholic edition with Deuterocanon.",
        helloao_id: Some("eng_webc"),
        bible_api_id: None,
        default_provider: "open",
        api_bible_abbrev: None,
    },
    CatalogEntry {
        id: "LXX",
        name: "English Septuagint (LXX - Orthodox OT)",
        year: "2012",
        category: "catholic_orthodox",
        category_label: "4. Catholic & Orthodox Canons",
        description: "Public-domain English translation of the Greek Septuagint Old Testament.",
        helloao_id: Some("eng_lxx"),
        bible_api_id: None,
        default_provider: "open",
        api_bible_abbrev: None,
    },

    // 5. Jewish English Translations (Tanakh)
    CatalogEntry {
        id: "NJPS",
        name: "NJPS Tanakh (New Jewish Publication Society)",
        year: "1985",
        category: "jewish",
        category_label: "5. Jewish English (Tanakh)",
        description: "Standard modern Jewish translation of the Masoretic Text (import local file).",
        helloao_id: None,
        bible_api_id: None,
        default_provider: "local",
        api_bible_abbrev: Some("NJPS"),
    },
    CatalogEntry {
        id: "JPS1917",
        name: "JPS Tanakh (1917 Public Domain)",
        year: "1917",
        category: "jewish",
        category_label: "5. Jewish English (Tanakh)",
        description: "Classic Jewish Publication Society English Tanakh (ready online).",
        helloao_id: Some("eng_jps"),
        bible_api_id: None,
        default_provider: "open",
        api_bible_abbrev: None,
    },
    CatalogEntry {
        id: "OJB",
        name: "Orthodox Jewish Bible (OJB)",
        year: "2002",
        category: "jewish",
        category_label: "5. Jewish English (Tanakh)",
        description: "Retains traditional Hebrew names and rabbinic terminology (ready online).",
        helloao_id: Some("eng_ojb"),
        bible_api_id: None,
        default_provider: "open",
        api_bible_abbrev: None,
    },
    CatalogEntry {
        id: "KOREN",
        name: "The Koren Jerusalem Bible",
        year: "1962",
        category: "jewish",
        category_label: "5. Jewish English (Tanakh)",
        description: "Orthodox Jewish translation retaining Hebrew names (import local file).",
        helloao_id: None,
        bible_api_id: None,
        default_provider: "local",
        api_bible_abbrev: None,
    },
    CatalogEntry {
        id: "ARTSCROLL",
        name: "ArtScroll Stone Edition Tanach",
        year: "1996",
        category: "jewish",
        category_label: "5. Jewish English (Tanakh)",
        description: "Reflects traditional Orthodox rabbinic commentary (import local file).",
        helloao_id: None,
        bible_api_id: None,
        default_provider: "local",
        api_bible_abbrev: None,
    },
    CatalogEntry {
        id: "ALTER",
        name: "Robert Alter's Hebrew Bible",
        year: "2018",
        category: "jewish",
        category_label: "5. Jewish English (Tanakh)",
        description: "Literary translation preserving Biblical Hebrew poetry and rhythm (import local file).",
        helloao_id: None,
        bible_api_id: None,
        default_provider: "local",
        api_bible_abbrev: None,
    },

    // 6. Major Historical Predecessors
    CatalogEntry {
        id: "WYCLIFFE",
        name: "Wycliffe's Bible",
        year: "1382",
        category: "historical",
        category_label: "6. Historical Predecessors",
        description: "First complete English Bible, translated from the Latin Vulgate.",
        helloao_id: Some("eng_w88"),
        bible_api_id: None,
        default_provider: "open",
        api_bible_abbrev: None,
    },
    CatalogEntry {
        id: "TYNDALE",
        name: "Tyndale Bible (New Testament)",
        year: "1526 - 1535",
        category: "historical",
        category_label: "6. Historical Predecessors",
        description: "William Tyndale's landmark translation direct from Greek and Hebrew.",
        helloao_id: Some("eng_tnt"),
        bible_api_id: None,
        default_provider: "open",
        api_bible_abbrev: None,
    },
    CatalogEntry {
        id: "COVERDALE",
        name: "Coverdale Bible",
        year: "1535",
        category: "historical",
        category_label: "6. Historical Predecessors",
        description: "First complete printed English Bible (import local XML/JSON file).",
        helloao_id: None,
        bible_api_id: None,
        default_provider: "local",
        api_bible_abbrev: None,
    },
    CatalogEntry {
        id: "GENEVA",
        name: "Geneva Bible",
        year: "1560 / 1599",
        category: "historical",
        category_label: "6. Historical Predecessors",
        description: "First English Bible with numbered verses and marginal study notes.",
        helloao_id: Some("eng_gnv"),
        bible_api_id: None,
        default_provider: "open",
        api_bible_abbrev: None,
    },
    CatalogEntry {
        id: "BISHOPS",
        name: "Bishops' Bible",
        year: "1568",
        category: "historical",
        category_label: "6. Historical Predecessors",
        description: "Official Church of England pulpit Bible prior to 1611 (import local file).",
        helloao_id: None,
        bible_api_id: None,
        default_provider: "local",
        api_bible_abbrev: None,
    },
    CatalogEntry {
        id: "ASV",
        name: "American Standard Version (ASV)",
        year: "1901",
        category: "historical",
        category_label: "6. Historical Predecessors",
        description: "Literal 1901 American revision rendering YHWH as Jehovah.",
        helloao_id: Some("eng_asv"),
        bible_api_id: Some("asv"),
        default_provider: "open",
        api_bible_abbrev: Some("ASV"),
    },
];

pub fn default_local_bibles_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from);
    #[cfg(not(target_os = "windows"))]
    let home = std::env::var_os("HOME").map(PathBuf::from);
    home.map(|h| h.join(".onering").join("bibles"))
}

fn scan_local_bible_files(custom_dir: &str) -> HashMap<String, PathBuf> {
    let mut found = HashMap::new();
    let mut dirs = Vec::new();
    if let Some(def) = default_local_bibles_dir() {
        dirs.push(def);
    }
    let trimmed = custom_dir.trim();
    if !trimmed.is_empty() {
        let p = PathBuf::from(trimmed);
        if !p.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            dirs.push(p);
        }
    }
    for dir in dirs {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if !matches!(ext.as_str(), "xml" | "osis" | "xmm" | "json") {
                continue;
            }
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                let code = normalize_code(stem);
                if !code.is_empty() {
                    found.insert(code, path);
                }
            }
        }
    }
    found
}

fn normalize_code(raw: &str) -> String {
    raw.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_uppercase()
}

pub fn list_translations(cfg: &BibleProviderConfig) -> Vec<BibleTranslationInfo> {
    let local_files = scan_local_bible_files(&cfg.local_bibles_dir);
    let has_esv = !cfg.esv_api_key.trim().is_empty();
    let has_api_bible = !cfg.api_bible_key.trim().is_empty();

    let mut out = Vec::with_capacity(CATALOG.len() + local_files.len());
    let mut seen_codes = std::collections::HashSet::new();

    for entry in CATALOG {
        let code = normalize_code(entry.id);
        seen_codes.insert(code.clone());
        let local_path = local_files.get(&code);

        let (status, provider) = if local_path.is_some() {
            ("ready".to_string(), "local".to_string())
        } else if entry.default_provider == "open" {
            ("ready".to_string(), "open_online".to_string())
        } else if entry.default_provider == "esv_api" {
            if has_esv {
                ("ready".to_string(), "esv_api".to_string())
            } else {
                ("needs_esv_key".to_string(), "esv_api".to_string())
            }
        } else if entry.default_provider == "api_bible" {
            if has_api_bible {
                ("ready".to_string(), "api_bible".to_string())
            } else {
                ("needs_api_bible_key".to_string(), "api_bible".to_string())
            }
        } else {
            ("needs_local_file".to_string(), "local_import".to_string())
        };

        out.push(BibleTranslationInfo {
            id: entry.id.to_string(),
            name: entry.name.to_string(),
            year: entry.year.to_string(),
            category: entry.category.to_string(),
            category_label: entry.category_label.to_string(),
            description: entry.description.to_string(),
            status,
            provider,
            local_file_path: local_path.map(|p| p.display().to_string()),
        });
    }

    let mut extras: Vec<(String, PathBuf)> = local_files
        .into_iter()
        .filter(|(k, _)| !seen_codes.contains(k))
        .collect();
    extras.sort_by(|a, b| a.0.cmp(&b.0));
    for (code, path) in extras {
        out.push(BibleTranslationInfo {
            id: code.clone(),
            name: format!("{code} (Custom Local Bible)"),
            year: "Local".to_string(),
            category: "local_custom".to_string(),
            category_label: "7. Custom Local Bibles".to_string(),
            description: format!(
                "Offline local Bible file: {}",
                path.file_name().and_then(|n| n.to_str()).unwrap_or("file")
            ),
            status: "ready".to_string(),
            provider: "local".to_string(),
            local_file_path: Some(path.display().to_string()),
        });
    }

    out
}

pub fn import_local_bible_file(
    source_path: &str,
    translation_code: Option<&str>,
    custom_dir: &str,
) -> Result<BibleTranslationInfo, String> {
    let raw_src = Path::new(source_path.trim());
    if raw_src.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err("Invalid Bible file path: parent directory traversal ('..') is not allowed.".into());
    }
    let src = fs::canonicalize(raw_src)
        .map_err(|_| format!("Bible file not found: {}", raw_src.display()))?;
    if !src.is_file() {
        return Err(format!("Bible file not found: {}", src.display()));
    }
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(ext.as_str(), "xml" | "osis" | "xmm" | "json") {
        return Err("Unsupported format. Import a Zefania XML (.xml), OSIS (.osis/.xml), OpenSong (.xmm/.xml), or JSON (.json) Bible file.".into());
    }

    let meta = fs::metadata(&src).map_err(|e| format!("Could not read Bible file metadata: {e}"))?;
    if meta.len() > 64 * 1024 * 1024 {
        return Err("Bible file exceeds 64 MB limit.".into());
    }
    let raw_preview = fs::read_to_string(&src).map_err(|e| format!("Bible file must be valid UTF-8 text: {e}"))?;
    if raw_preview.trim().is_empty() {
        return Err("Bible file is empty.".into());
    }

    let code = translation_code
        .map(normalize_code)
        .filter(|c| !c.is_empty())
        .or_else(|| src.file_stem().and_then(|s| s.to_str()).map(normalize_code))
        .filter(|c| !c.is_empty())
        .ok_or_else(|| "Could not determine translation code from filename.".to_string())?;

    let dest_dir = if !custom_dir.trim().is_empty() {
        let p = PathBuf::from(custom_dir.trim());
        if p.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            return Err("Invalid local Bibles directory: parent directory traversal ('..') is not allowed.".into());
        }
        p
    } else {
        default_local_bibles_dir().ok_or_else(|| "Could not resolve ~/.onering/bibles directory".to_string())?
    };
    fs::create_dir_all(&dest_dir).map_err(|e| format!("Failed to create Bibles directory: {e}"))?;
    let dest = dest_dir.join(format!("{code}.{ext}"));
    if dest != src {
        fs::copy(&src, &dest).map_err(|e| format!("Failed to copy Bible file into One Ring library: {e}"))?;
    }

    let cfg = BibleProviderConfig {
        esv_api_key: String::new(),
        api_bible_key: String::new(),
        local_bibles_dir: custom_dir.to_string(),
    };
    list_translations(&cfg)
        .into_iter()
        .find(|t| normalize_code(&t.id) == code)
        .ok_or_else(|| "Imported Bible file saved, but could not be indexed.".into())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedReference {
    pub canonical_book: &'static str,
    pub usfm: &'static str,
    pub chapter: u32,
    pub verse_start: Option<u32>,
    pub verse_end: Option<u32>,
}

const BOOKS: &[(&str, &str, &[&str])] = &[
    // Old Testament (39)
    ("Genesis", "GEN", &["genesis", "gen", "ge", "gn"]),
    ("Exodus", "EXO", &["exodus", "exod", "ex", "exo"]),
    ("Leviticus", "LEV", &["leviticus", "lev", "lv"]),
    ("Numbers", "NUM", &["numbers", "num", "nm", "nb"]),
    ("Deuteronomy", "DEU", &["deuteronomy", "deut", "dt", "deu"]),
    ("Joshua", "JOS", &["joshua", "josh", "jos"]),
    ("Judges", "JDG", &["judges", "judg", "jdg", "jg"]),
    ("Ruth", "RUT", &["ruth", "rut", "ru"]),
    ("1 Samuel", "1SA", &["1 samuel", "1samuel", "1 sam", "1sam", "1sa"]),
    ("2 Samuel", "2SA", &["2 samuel", "2samuel", "2 sam", "2sam", "2sa"]),
    ("1 Kings", "1KI", &["1 kings", "1kings", "1 kgs", "1kgs", "1ki", "1 king"]),
    ("2 Kings", "2KI", &["2 kings", "2kings", "2 kgs", "2kgs", "2ki", "2 king"]),
    ("1 Chronicles", "1CH", &["1 chronicles", "1chronicles", "1 chron", "1chron", "1ch", "1 chr"]),
    ("2 Chronicles", "2CH", &["2 chronicles", "2chronicles", "2 chron", "2chron", "2ch", "2 chr"]),
    ("Ezra", "EZR", &["ezra", "ezr"]),
    ("Nehemiah", "NEH", &["nehemiah", "neh", "ne"]),
    ("Esther", "EST", &["esther", "est", "es"]),
    ("Job", "JOB", &["job", "jb"]),
    ("Psalms", "PSA", &["psalms", "psalm", "psa", "ps", "pss"]),
    ("Proverbs", "PRO", &["proverbs", "proverb", "prov", "pro", "pr"]),
    ("Ecclesiastes", "ECC", &["ecclesiastes", "eccl", "ecc", "ec", "qoh"]),
    ("Song of Solomon", "SNG", &["song of solomon", "song of songs", "songs", "song", "sng", "sos", "cant"]),
    ("Isaiah", "ISA", &["isaiah", "isa", "is"]),
    ("Jeremiah", "JER", &["jeremiah", "jer", "je"]),
    ("Lamentations", "LAM", &["lamentations", "lam", "la"]),
    ("Ezekiel", "EZK", &["ezekiel", "ezek", "ezk", "eze"]),
    ("Daniel", "DAN", &["daniel", "dan", "dn", "da"]),
    ("Hosea", "HOS", &["hosea", "hos", "ho"]),
    ("Joel", "JOL", &["joel", "jol", "jl"]),
    ("Amos", "AMO", &["amos", "amo", "am"]),
    ("Obadiah", "OBA", &["obadiah", "obad", "oba", "ob"]),
    ("Jonah", "JON", &["jonah", "jon", "jnh"]),
    ("Micah", "MIC", &["micah", "mic", "mi"]),
    ("Nahum", "NAM", &["nahum", "nah", "nam", "na"]),
    ("Habakkuk", "HAB", &["habakkuk", "hab", "hb"]),
    ("Zephaniah", "ZEP", &["zephaniah", "zeph", "zep", "zp"]),
    ("Haggai", "HAG", &["haggai", "hag", "hg"]),
    ("Zechariah", "ZEC", &["zechariah", "zech", "zec", "zc"]),
    ("Malachi", "MAL", &["malachi", "mal", "ml"]),
    // New Testament (27)
    ("Matthew", "MAT", &["matthew", "matt", "mat", "mt"]),
    ("Mark", "MRK", &["mark", "mrk", "mk", "mr"]),
    ("Luke", "LUK", &["luke", "luk", "lk"]),
    ("John", "JHN", &["john", "jhn", "jn", "joh"]),
    ("Acts", "ACT", &["acts", "act", "ac"]),
    ("Romans", "ROM", &["romans", "rom", "ro", "rm"]),
    ("1 Corinthians", "1CO", &["1 corinthians", "1corinthians", "1 cor", "1cor", "1co"]),
    ("2 Corinthians", "2CO", &["2 corinthians", "2corinthians", "2 cor", "2cor", "2co"]),
    ("Galatians", "GAL", &["galatians", "gal", "ga"]),
    ("Ephesians", "EPH", &["ephesians", "eph", "ep"]),
    ("Philippians", "PHP", &["philippians", "phil", "php", "pp"]),
    ("Colossians", "COL", &["colossians", "col", "co"]),
    ("1 Thessalonians", "1TH", &["1 thessalonians", "1thessalonians", "1 thess", "1thess", "1th"]),
    ("2 Thessalonians", "2TH", &["2 thessalonians", "2thessalonians", "2 thess", "2thess", "2th"]),
    ("1 Timothy", "1TI", &["1 timothy", "1timothy", "1 tim", "1tim", "1ti"]),
    ("2 Timothy", "2TI", &["2 timothy", "2timothy", "2 tim", "2tim", "2ti"]),
    ("Titus", "TIT", &["titus", "tit", "ti"]),
    ("Philemon", "PHM", &["philemon", "phlm", "phm", "pm"]),
    ("Hebrews", "HEB", &["hebrews", "heb", "he"]),
    ("James", "JAS", &["james", "jas", "jm", "jam"]),
    ("1 Peter", "1PE", &["1 peter", "1peter", "1 pet", "1pet", "1pe", "1pt"]),
    ("2 Peter", "2PE", &["2 peter", "2peter", "2 pet", "2pet", "2pe", "2pt"]),
    ("1 John", "1JN", &["1 john", "1john", "1 jn", "1jn", "1joh"]),
    ("2 John", "2JN", &["2 john", "2john", "2 jn", "2jn", "2joh"]),
    ("3 John", "3JN", &["3 john", "3john", "3 jn", "3jn", "3joh"]),
    ("Jude", "JUD", &["jude", "jud", "jd"]),
    ("Revelation", "REV", &["revelation", "revelations", "rev", "re", "apoc"]),
    // Deuterocanon / Catholic & Orthodox (7+)
    ("Tobit", "TOB", &["tobit", "tob"]),
    ("Judith", "JDT", &["judith", "jdt", "jdth"]),
    ("Wisdom", "WIS", &["wisdom", "wisdom of solomon", "wis", "ws"]),
    ("Sirach", "SIR", &["sirach", "ecclesiasticus", "sir", "ecclus"]),
    ("Baruch", "BAR", &["baruch", "bar"]),
    ("1 Maccabees", "1MA", &["1 maccabees", "1maccabees", "1 macc", "1macc", "1ma"]),
    ("2 Maccabees", "2MA", &["2 maccabees", "2maccabees", "2 macc", "2macc", "2ma"]),
];

pub fn parse_scripture_reference(raw: &str) -> Result<ParsedReference, String> {
    let cleaned = raw
        .trim()
        .replace('\u{2013}', "-")
        .replace('\u{2014}', "-")
        .replace('.', " ");
    let normalized: String = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return Err("Enter a scripture reference (e.g. John 3:16 or Psalm 23).".into());
    }

    let split_idx = normalized
        .rfind(' ')
        .ok_or_else(|| format!("Include a chapter number (e.g. \"John 3:16\"), got \"{normalized}\"."))?;
    let book_part = normalized[..split_idx].trim().to_ascii_lowercase();
    let num_part = normalized[split_idx + 1..].trim();

    let (canonical_book, usfm) = BOOKS
        .iter()
        .find(|(_, _, aliases)| aliases.iter().any(|a| *a == book_part))
        .map(|(name, code, _)| (*name, *code))
        .ok_or_else(|| format!("Unrecognized Bible book \"{book_part}\". Try e.g. John 3:16, Psalm 23, 1 Cor 13:4-7."))?;

    let (chapter, verse_start, verse_end) = if let Some((ch_s, v_s)) = num_part.split_once(':') {
        let ch: u32 = ch_s
            .trim()
            .parse()
            .map_err(|_| format!("Invalid chapter number \"{ch_s}\""))?;
        if let Some((vs_s, ve_s)) = v_s.split_once('-') {
            let vs: u32 = vs_s.trim().parse().map_err(|_| format!("Invalid start verse \"{vs_s}\""))?;
            let ve: u32 = ve_s.trim().parse().map_err(|_| format!("Invalid end verse \"{ve_s}\""))?;
            (ch, Some(vs), Some(ve.max(vs)))
        } else {
            let v: u32 = v_s.trim().parse().map_err(|_| format!("Invalid verse number \"{v_s}\""))?;
            (ch, Some(v), Some(v))
        }
    } else {
        let ch: u32 = num_part
            .parse()
            .map_err(|_| format!("Invalid chapter number \"{num_part}\""))?;
        (ch, None, None)
    };

    Ok(ParsedReference {
        canonical_book,
        usfm,
        chapter,
        verse_start,
        verse_end,
    })
}

fn filter_verses(verses: Vec<BibleVerse>, parsed: &ParsedReference) -> Vec<BibleVerse> {
    match (parsed.verse_start, parsed.verse_end) {
        (Some(start), Some(end)) => verses
            .into_iter()
            .filter(|v| v.verse >= start && v.verse <= end)
            .collect(),
        (Some(start), None) => verses.into_iter().filter(|v| v.verse == start).collect(),
        _ => verses,
    }
}

fn format_canonical_ref(parsed: &ParsedReference) -> String {
    match (parsed.verse_start, parsed.verse_end) {
        (Some(s), Some(e)) if s == e => format!("{} {}:{}", parsed.canonical_book, parsed.chapter, s),
        (Some(s), Some(e)) => format!("{} {}:{}-{}", parsed.canonical_book, parsed.chapter, s, e),
        (Some(s), None) => format!("{} {}:{}", parsed.canonical_book, parsed.chapter, s),
        _ => format!("{} {}", parsed.canonical_book, parsed.chapter),
    }
}

pub fn lookup_passage(
    reference: &str,
    translation_id: &str,
    cfg: &BibleProviderConfig,
) -> Result<BiblePassageResult, String> {
    let parsed = parse_scripture_reference(reference)?;
    let code = normalize_code(translation_id);
    let canonical_ref = format_canonical_ref(&parsed);

    // 1. Local Offline Bible file always wins if installed!
    let local_files = scan_local_bible_files(&cfg.local_bibles_dir);
    if let Some(local_path) = local_files.get(&code) {
        let verses = lookup_local_file(local_path, &parsed)?;
        if !verses.is_empty() {
            let name = CATALOG
                .iter()
                .find(|c| normalize_code(c.id) == code)
                .map(|c| c.name.to_string())
                .unwrap_or_else(|| format!("{code} (Local Bible)"));
            return Ok(BiblePassageResult {
                reference: canonical_ref,
                translation_id: code,
                translation_name: name,
                source: format!(
                    "Local Offline ({})",
                    local_path.file_name().and_then(|n| n.to_str()).unwrap_or("file")
                ),
                copyright_notice: "Loaded from local church Bible library".into(),
                verses,
            });
        }
    }

    let entry = CATALOG.iter().find(|c| normalize_code(c.id) == code);
    let trans_name = entry
        .map(|c| c.name.to_string())
        .unwrap_or_else(|| code.clone());

    // 2. Official Crossway ESV API (requires free user API key from api.esv.org)
    if code == "ESV" {
        let key = cfg.esv_api_key.trim();
        if key.is_empty() {
            return Err("ESV requires either your free Crossway API key (api.esv.org) or a local ESV Bible file.".into());
        }
        let verses = fetch_esv_api(&canonical_ref, key)?;
        return Ok(BiblePassageResult {
            reference: canonical_ref,
            translation_id: "ESV".into(),
            translation_name: trans_name,
            source: "Crossway Official ESV API".into(),
            copyright_notice: "Scripture quotations are from the ESV Bible (The Holy Bible, English Standard Version), © 2001 by Crossway.".into(),
            verses,
        });
    }

    // 3. Open-license online providers (helloao.org -> bible-api.com fallback)
    if let Some(cat) = entry {
        if let Some(helloao_id) = cat.helloao_id {
            if let Ok(verses) = fetch_helloao(helloao_id, &parsed) {
                if !verses.is_empty() {
                    return Ok(BiblePassageResult {
                        reference: canonical_ref,
                        translation_id: cat.id.to_string(),
                        translation_name: trans_name,
                        source: "Open Scripture API (helloao.org)".into(),
                        copyright_notice: "Public Domain / Open License".into(),
                        verses,
                    });
                }
            }
        }
        if let Some(bapi_id) = cat.bible_api_id {
            if let Ok(verses) = fetch_bible_api_com(&canonical_ref, bapi_id) {
                if !verses.is_empty() {
                    return Ok(BiblePassageResult {
                        reference: canonical_ref,
                        translation_id: cat.id.to_string(),
                        translation_name: trans_name,
                        source: "Open Scripture API (bible-api.com)".into(),
                        copyright_notice: "Public Domain / Open License".into(),
                        verses,
                    });
                }
            }
        }

        // 4. Official API.Bible (if key is configured)
        let ab_key = cfg.api_bible_key.trim();
        if !ab_key.is_empty() {
            if let Some(abbrev) = cat.api_bible_abbrev {
                match fetch_api_bible(&parsed, abbrev, ab_key) {
                    Ok(verses) if !verses.is_empty() => {
                        return Ok(BiblePassageResult {
                            reference: canonical_ref,
                            translation_id: cat.id.to_string(),
                            translation_name: trans_name,
                            source: "API.Bible".into(),
                            copyright_notice: "Retrieved via API.Bible with operator key".into(),
                            verses,
                        });
                    }
                    Err(e) if cat.default_provider == "api_bible" => return Err(e),
                    _ => {}
                }
            }
        }

        if cat.default_provider == "api_bible" {
            return Err(format!(
                "{} requires a free API.Bible key (scripture.api.bible) or a local XML/JSON Bible file.",
                cat.name
            ));
        }
        return Err(format!(
            "{} is publisher-copyrighted. Click 'Import Local Bible File' (OSIS / Zefania / OpenSong XML or JSON) to load your church's licensed copy offline.",
            cat.name
        ));
    }

    Err(format!("Translation \"{translation_id}\" is not installed. Import a local XML/JSON Bible file or choose an available translation."))
}

fn percent_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len() * 2);
    for b in input.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

#[cfg(not(target_os = "windows"))]
fn https_get_bytes(url: &str, auth_header: Option<(&str, &str)>) -> Result<Vec<u8>, String> {
    if !url.starts_with("https://") {
        return Err("Refusing non-HTTPS scripture request".into());
    }
    let mut cmd = std::process::Command::new("curl");
    crate::runtime::hide_console_window(&mut cmd);
    cmd.args([
        "-fsSL",
        "--max-time",
        "10",
        "--max-filesize",
        "2097152",
        "-H",
        "User-Agent: OneRing/0.3.9",
    ]);
    if let Some((hname, hval)) = auth_header {
        cmd.arg("-H").arg(format!("{hname}: {hval}"));
    }
    cmd.arg(url);
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to invoke curl for scripture lookup: {e}"))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Scripture API request failed: {}", err.trim()));
    }
    Ok(output.stdout)
}

#[cfg(target_os = "windows")]
fn https_get_bytes(url: &str, auth_header: Option<(&str, &str)>) -> Result<Vec<u8>, String> {
    if !url.starts_with("https://") {
        return Err("Refusing non-HTTPS scripture request".into());
    }
    let script = concat!(
        "$ErrorActionPreference='Stop';",
        "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;",
        "$h=@{'User-Agent'='OneRing/0.3.9'};",
        "if ($env:ONERING_BIBLE_HNAME -and $env:ONERING_BIBLE_HVAL) { $h[$env:ONERING_BIBLE_HNAME]=$env:ONERING_BIBLE_HVAL };",
        "$r=Invoke-WebRequest -Uri $env:ONERING_BIBLE_URL -TimeoutSec 10 -UseBasicParsing -Headers $h;",
        "[Console]::Out.Write($r.Content)"
    );
    let mut cmd = std::process::Command::new("powershell");
    crate::runtime::hide_console_window(&mut cmd);
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", script])
        .env("ONERING_BIBLE_URL", url);
    if let Some((hname, hval)) = auth_header {
        cmd.env("ONERING_BIBLE_HNAME", hname)
            .env("ONERING_BIBLE_HVAL", hval);
    }
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to fetch scripture: {e}"))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Scripture API request failed: {}", err.trim()));
    }
    Ok(output.stdout)
}

fn fetch_helloao(helloao_id: &str, parsed: &ParsedReference) -> Result<Vec<BibleVerse>, String> {
    let url = format!(
        "https://bible.helloao.org/api/{}/{}/{}.json",
        helloao_id, parsed.usfm, parsed.chapter
    );
    let bytes = https_get_bytes(&url, None)?;
    let json: Value = serde_json::from_slice(&bytes)
        .map_err(|e| format!("Invalid helloao.org JSON: {e}"))?;
    let content = json
        .pointer("/chapter/content")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Chapter not available in this translation".to_string())?;

    let mut verses = Vec::new();
    for item in content {
        if item.get("type").and_then(|t| t.as_str()) != Some("verse") {
            continue;
        }
        let Some(num) = item.get("number").and_then(|n| n.as_u64()) else {
            continue;
        };
        let mut parts = Vec::new();
        if let Some(arr) = item.get("content").and_then(|c| c.as_array()) {
            for seg in arr {
                if let Some(s) = seg.as_str() {
                    let t = s.trim();
                    if !t.is_empty() {
                        parts.push(t.to_string());
                    }
                } else if let Some(t) = seg.get("text").and_then(|x| x.as_str()) {
                    let t = t.trim();
                    if !t.is_empty() {
                        parts.push(t.to_string());
                    }
                }
            }
        }
        let text = parts.join(" ").replace("  ", " ").trim().to_string();
        if !text.is_empty() {
            verses.push(BibleVerse {
                verse: num as u32,
                text,
            });
        }
    }
    Ok(filter_verses(verses, parsed))
}

fn fetch_bible_api_com(canonical_ref: &str, translation_id: &str) -> Result<Vec<BibleVerse>, String> {
    let url = format!(
        "https://bible-api.com/{}?translation={}",
        percent_encode(canonical_ref),
        percent_encode(translation_id)
    );
    let bytes = https_get_bytes(&url, None)?;
    let json: Value = serde_json::from_slice(&bytes)
        .map_err(|e| format!("Invalid bible-api.com JSON: {e}"))?;
    let arr = json
        .get("verses")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Passage not found on bible-api.com".to_string())?;
    let mut verses = Vec::new();
    for v in arr {
        let num = v.get("verse").and_then(|n| n.as_u64()).unwrap_or(0) as u32;
        let text = v
            .get("text")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        if num > 0 && !text.is_empty() {
            verses.push(BibleVerse { verse: num, text });
        }
    }
    Ok(verses)
}

fn fetch_esv_api(canonical_ref: &str, api_key: &str) -> Result<Vec<BibleVerse>, String> {
    let url = format!(
        "https://api.esv.org/v3/passage/text/?q={}&include-passage-references=false&include-verse-numbers=true&include-first-verse-numbers=true&include-footnotes=false&include-headings=false&include-short-copyright=false",
        percent_encode(canonical_ref)
    );
    let auth = format!("Token {}", api_key.trim());
    let bytes = https_get_bytes(&url, Some(("Authorization", &auth)))?;
    let json: Value = serde_json::from_slice(&bytes)
        .map_err(|e| format!("Invalid ESV API response: {e}"))?;
    let passages = json
        .get("passages")
        .and_then(|p| p.as_array())
        .ok_or_else(|| "ESV API returned no passages. Check your Crossway API token.".to_string())?;
    let combined = passages
        .iter()
        .filter_map(|p| p.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let verses = parse_bracketed_verses(&combined);
    if verses.is_empty() {
        return Err("No verses returned by ESV API for that reference.".into());
    }
    Ok(verses)
}

pub fn parse_bracketed_verses(raw: &str) -> Vec<BibleVerse> {
    let mut verses = Vec::new();
    let mut current_num: Option<u32> = None;
    let mut current_text = String::new();
    let bytes = raw.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] == b'[' {
            if let Some(rel_end) = raw[i + 1..].find(']') {
                let inner = raw[i + 1..i + 1 + rel_end].trim();
                if !inner.is_empty() && inner.chars().all(|c| c.is_ascii_digit()) {
                    if let Ok(num) = inner.parse::<u32>() {
                        if let Some(prev_num) = current_num {
                            let cleaned = current_text.split_whitespace().collect::<Vec<_>>().join(" ");
                            if !cleaned.is_empty() {
                                verses.push(BibleVerse {
                                    verse: prev_num,
                                    text: cleaned,
                                });
                            }
                        }
                        current_num = Some(num);
                        current_text.clear();
                        i += rel_end + 2;
                        continue;
                    }
                }
            }
        }
        if let Some(ch) = raw[i..].chars().next() {
            if current_num.is_some() {
                current_text.push(ch);
            }
            i += ch.len_utf8();
        } else {
            break;
        }
    }

    if let Some(prev_num) = current_num {
        let cleaned = current_text.split_whitespace().collect::<Vec<_>>().join(" ");
        if !cleaned.is_empty() {
            verses.push(BibleVerse {
                verse: prev_num,
                text: cleaned,
            });
        }
    }
    verses
}

fn fetch_api_bible(parsed: &ParsedReference, abbrev: &str, api_key: &str) -> Result<Vec<BibleVerse>, String> {
    let list_url = format!(
        "https://api.scripture.api.bible/v1/bibles?language=eng&abbreviation={}",
        percent_encode(abbrev)
    );
    let list_bytes = https_get_bytes(&list_url, Some(("api-key", api_key.trim())))?;
    let list_json: Value = serde_json::from_slice(&list_bytes)
        .map_err(|e| format!("Invalid API.Bible response: {e}"))?;
    let bible_id = list_json
        .get("data")
        .and_then(|d| d.as_array())
        .and_then(|arr| arr.first())
        .and_then(|b| b.get("id"))
        .and_then(|id| id.as_str())
        .ok_or_else(|| format!("Translation \"{abbrev}\" is not enabled on your API.Bible key. Import a local file or check scripture.api.bible."))?;

    let passage_id = match (parsed.verse_start, parsed.verse_end) {
        (Some(s), Some(e)) if s == e => format!("{}.{}.{}", parsed.usfm, parsed.chapter, s),
        (Some(s), Some(e)) => format!("{}.{}.{}-{}.{}.{}", parsed.usfm, parsed.chapter, s, parsed.usfm, parsed.chapter, e),
        _ => format!("{}.{}", parsed.usfm, parsed.chapter),
    };
    let pass_url = format!(
        "https://api.scripture.api.bible/v1/bibles/{}/passages/{}?content-type=text&include-notes=false&include-titles=false&include-chapter-numbers=false&include-verse-numbers=true",
        percent_encode(bible_id),
        percent_encode(&passage_id)
    );
    let pass_bytes = https_get_bytes(&pass_url, Some(("api-key", api_key.trim())))?;
    let pass_json: Value = serde_json::from_slice(&pass_bytes)
        .map_err(|e| format!("Invalid API.Bible passage JSON: {e}"))?;
    let content = pass_json
        .pointer("/data/content")
        .and_then(|c| c.as_str())
        .unwrap_or("");
    let verses = parse_bracketed_verses(content);
    if verses.is_empty() && !content.trim().is_empty() {
        return Ok(vec![BibleVerse {
            verse: parsed.verse_start.unwrap_or(1),
            text: content.split_whitespace().collect::<Vec<_>>().join(" "),
        }]);
    }
    Ok(verses)
}

pub fn lookup_local_file(path: &Path, parsed: &ParsedReference) -> Result<Vec<BibleVerse>, String> {
    let raw = fs::read_to_string(path).map_err(|e| format!("Failed to read local Bible file: {e}"))?;
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ext == "json" {
        parse_local_json(&raw, parsed)
    } else {
        parse_local_xml(&raw, parsed)
    }
}

pub fn parse_local_json(raw: &str, parsed: &ParsedReference) -> Result<Vec<BibleVerse>, String> {
    let val: Value = serde_json::from_str(raw).map_err(|e| format!("Invalid local Bible JSON: {e}"))?;
    let mut verses = Vec::new();

    let book_map = val.get("books").unwrap_or(&val);
    if let Some(obj) = book_map.as_object() {
        let target_book = obj.iter().find(|(k, _)| book_matches_name(k, parsed));
        if let Some((_, ch_map)) = target_book {
            if let Some(v_map) = ch_map.get(&parsed.chapter.to_string()).and_then(|c| c.as_object()) {
                for (vk, vt) in v_map {
                    if let (Ok(vnum), Some(text)) = (vk.parse::<u32>(), vt.as_str()) {
                        verses.push(BibleVerse {
                            verse: vnum,
                            text: text.trim().to_string(),
                        });
                    }
                }
            }
        }
    }

    if verses.is_empty() {
        let arr_opt = val.get("verses").and_then(|v| v.as_array()).or_else(|| val.as_array());
        if let Some(arr) = arr_opt {
            for item in arr {
                let bname = item
                    .get("book")
                    .or_else(|| item.get("book_name"))
                    .and_then(|b| b.as_str())
                    .unwrap_or("");
                let ch = item.get("chapter").and_then(|c| c.as_u64()).unwrap_or(0) as u32;
                if ch == parsed.chapter && book_matches_name(bname, parsed) {
                    if let (Some(vnum), Some(text)) = (
                        item.get("verse").and_then(|v| v.as_u64()),
                        item.get("text").and_then(|t| t.as_str()),
                    ) {
                        verses.push(BibleVerse {
                            verse: vnum as u32,
                            text: text.trim().to_string(),
                        });
                    }
                }
            }
        }
    }

    verses.sort_by_key(|v| v.verse);
    Ok(filter_verses(verses, parsed))
}

fn book_matches_name(candidate: &str, parsed: &ParsedReference) -> bool {
    let c = candidate.trim().to_ascii_lowercase();
    if c == parsed.canonical_book.to_ascii_lowercase() || c == parsed.usfm.to_ascii_lowercase() {
        return true;
    }
    BOOKS
        .iter()
        .find(|(_, usfm, _)| *usfm == parsed.usfm)
        .map(|(_, _, aliases)| aliases.iter().any(|a| *a == c))
        .unwrap_or(false)
}

fn strip_xml_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for ch in s.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn extract_attr(tag: &str, attr: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let needle = format!("{}=", attr.to_ascii_lowercase());
    let idx = lower.find(&needle)?;
    let rest = &tag[idx + needle.len()..];
    let quote = rest.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let after = &rest[1..];
    let end = after.find(quote)?;
    Some(after[..end].to_string())
}

pub fn parse_local_xml(raw: &str, parsed: &ParsedReference) -> Result<Vec<BibleVerse>, String> {
    let mut verses = Vec::new();
    let mut in_book = false;
    let mut in_chapter = false;

    let mut pos = 0;
    while let Some(rel_lt) = raw[pos..].find('<') {
        let lt = pos + rel_lt;
        let Some(rel_gt) = raw[lt..].find('>') else {
            break;
        };
        let gt = lt + rel_gt;
        let tag = &raw[lt + 1..gt];
        let tag_trim = tag.trim();
        let tag_lower = tag_trim.to_ascii_lowercase();

        if tag_lower.starts_with("verse ") {
            if let Some(osis_id) = extract_attr(tag_trim, "osisID") {
                let parts: Vec<&str> = osis_id.split('.').collect();
                if parts.len() == 3
                    && book_matches_name(parts[0], parsed)
                    && parts[1].parse::<u32>().ok() == Some(parsed.chapter)
                {
                    if let Ok(vnum) = parts[2].parse::<u32>() {
                        if let Some(close_rel) = raw[gt + 1..].to_ascii_lowercase().find("</verse>") {
                            let body = strip_xml_tags(&raw[gt + 1..gt + 1 + close_rel]);
                            if !body.is_empty() {
                                verses.push(BibleVerse { verse: vnum, text: body });
                            }
                            pos = gt + 1 + close_rel + 8;
                            continue;
                        }
                    }
                }
            }
        } else if tag_lower.starts_with("biblebook ") || tag_lower.starts_with("b ") {
            let bname = extract_attr(tag_trim, "bname")
                .or_else(|| extract_attr(tag_trim, "n"))
                .or_else(|| extract_attr(tag_trim, "bsname"))
                .unwrap_or_default();
            in_book = book_matches_name(&bname, parsed);
            in_chapter = false;
        } else if tag_lower.starts_with("/biblebook") || tag_lower == "/b" {
            in_book = false;
            in_chapter = false;
        } else if in_book && (tag_lower.starts_with("chapter ") || tag_lower.starts_with("c ")) {
            let cnum = extract_attr(tag_trim, "cnumber")
                .or_else(|| extract_attr(tag_trim, "n"))
                .and_then(|s| s.parse::<u32>().ok());
            in_chapter = cnum == Some(parsed.chapter);
        } else if tag_lower.starts_with("/chapter") || tag_lower == "/c" {
            in_chapter = false;
        } else if in_book && in_chapter && (tag_lower.starts_with("vers ") || tag_lower.starts_with("v ")) {
            let vnum = extract_attr(tag_trim, "vnumber")
                .or_else(|| extract_attr(tag_trim, "n"))
                .and_then(|s| s.parse::<u32>().ok());
            let close_tag = if tag_lower.starts_with("vers ") { "</vers>" } else { "</v>" };
            if let Some(vn) = vnum {
                if let Some(close_rel) = raw[gt + 1..].to_ascii_lowercase().find(close_tag) {
                    let body = strip_xml_tags(&raw[gt + 1..gt + 1 + close_rel]);
                    if !body.is_empty() {
                        verses.push(BibleVerse { verse: vn, text: body });
                    }
                    pos = gt + 1 + close_rel + close_tag.len();
                    continue;
                }
            }
        }

        pos = gt + 1;
    }

    verses.sort_by_key(|v| v.verse);
    Ok(filter_verses(verses, parsed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_standard_and_deuterocanonical_references() {
        let r1 = parse_scripture_reference("John 3:16").unwrap();
        assert_eq!(r1.usfm, "JHN");
        assert_eq!(r1.chapter, 3);
        assert_eq!(r1.verse_start, Some(16));
        assert_eq!(r1.verse_end, Some(16));

        let r2 = parse_scripture_reference("1 Cor 13:4-7").unwrap();
        assert_eq!(r2.usfm, "1CO");
        assert_eq!(r2.chapter, 13);
        assert_eq!(r2.verse_start, Some(4));
        assert_eq!(r2.verse_end, Some(7));

        let r3 = parse_scripture_reference("Psalm 23").unwrap();
        assert_eq!(r3.usfm, "PSA");
        assert_eq!(r3.chapter, 23);
        assert_eq!(r3.verse_start, None);

        let r4 = parse_scripture_reference("Tobit 4:7").unwrap();
        assert_eq!(r4.usfm, "TOB");
        assert_eq!(r4.chapter, 4);
        assert_eq!(r4.verse_start, Some(7));
    }

    #[test]
    fn parses_esv_bracketed_verses() {
        let sample = "  [16] First verse text.  [17] Second verse text.\n";
        let v = parse_bracketed_verses(sample);
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].verse, 16);
        assert_eq!(v[0].text, "First verse text.");
        assert_eq!(v[1].verse, 17);
        assert_eq!(v[1].text, "Second verse text.");
    }

    #[test]
    fn parses_local_zefania_opensong_osis_and_json() {
        let parsed = parse_scripture_reference("John 3:16").unwrap();

        let zefania = r#"<XMLBIBLE><BIBLEBOOK bname="John"><CHAPTER cnumber="3"><VERS vnumber="16">Sample Zefania verse.</VERS></CHAPTER></BIBLEBOOK></XMLBIBLE>"#;
        let zv = parse_local_xml(zefania, &parsed).unwrap();
        assert_eq!(zv.len(), 1);
        assert_eq!(zv[0].text, "Sample Zefania verse.");

        let opensong = r#"<bible><b n="John"><c n="3"><v n="16">Sample OpenSong verse.</v></c></b></bible>"#;
        let ov = parse_local_xml(opensong, &parsed).unwrap();
        assert_eq!(ov.len(), 1);
        assert_eq!(ov[0].text, "Sample OpenSong verse.");

        let osis = r#"<osis><verse osisID="John.3.16">Sample OSIS verse.</verse></osis>"#;
        let osv = parse_local_xml(osis, &parsed).unwrap();
        assert_eq!(osv.len(), 1);
        assert_eq!(osv[0].text, "Sample OSIS verse.");

        let json = r#"{"books":{"John":{"3":{"16":"Sample JSON verse."}}}}"#;
        let jv = parse_local_json(json, &parsed).unwrap();
        assert_eq!(jv.len(), 1);
        assert_eq!(jv[0].text, "Sample JSON verse.");
    }

    #[test]
    fn catalog_covers_all_six_categories() {
        let cfg = BibleProviderConfig {
            esv_api_key: String::new(),
            api_bible_key: String::new(),
            local_bibles_dir: String::new(),
        };
        let list = list_translations(&cfg);
        assert!(list.len() >= 40);
        for cat in [
            "word_for_word",
            "thought_for_thought",
            "paraphrase",
            "catholic_orthodox",
            "jewish",
            "historical",
        ] {
            assert!(list.iter().any(|t| t.category == cat), "missing category {cat}");
        }
        assert!(list.iter().any(|t| t.id == "ESV"));
        assert!(list.iter().any(|t| t.id == "KJV" && t.status == "ready"));
    }
}
