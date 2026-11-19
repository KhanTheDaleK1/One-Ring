import React, { useState } from "react";
import { Search, Music, Key, Download, CheckCircle, ExternalLink, RefreshCw, X } from "lucide-react";

export interface SongSelectResult {
  ccliNumber: string;
  title: string;
  author: string;
  copyright: string;
  key: string;
  lyricsPreview: string;
  themes: string[];
}

interface CcliSongSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSong: (song: SongSelectResult) => void;
  ccliLicenseNumber?: string;
}

export const CcliSongSelectModal: React.FC<CcliSongSelectModalProps> = ({
  isOpen,
  onClose,
  onImportSong,
  ccliLicenseNumber = "11245892",
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SongSelectResult[]>([]);
  const [selectedSong, setSelectedSong] = useState<SongSelectResult | null>(null);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());

  if (!isOpen) return null;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchTerm.trim()) return;

    setIsSearching(true);
    // Simulated CCLI SongSelect API search with realistic hymn/contemporary library results
    setTimeout(() => {
      const term = searchTerm.toLowerCase();
      const mockDatabase: SongSelectResult[] = [
        {
          ccliNumber: "7065049",
          title: "Good Good Father",
          author: "Anthony Brown, Pat Barrett",
          copyright: "2014 Capitol CMG Paragon / Common Hymnal Publishing",
          key: "A",
          lyricsPreview:
            "I've heard a thousand stories\nOf what they think You're like\nBut I've heard the tender whisper\nOf love in the dead of night\nYou tell me that You're pleased\nAnd that I'm never alone",
          themes: ["God's Love", "Grace", "Identity", "Father"],
        },
        {
          ccliNumber: "7067561",
          title: "What A Beautiful Name",
          author: "Ben Fielding, Brooke Ligertwood",
          copyright: "2016 Hillsong Music Publishing Australia",
          key: "D",
          lyricsPreview:
            "You were the Word at the beginning\nOne with God the Lord Most High\nYour hidden glory in creation\nNow revealed in You our Christ\nWhat a beautiful Name it is\nWhat a beautiful Name it is",
          themes: ["Praise", "Worship", "Jesus", "Name of God"],
        },
        {
          ccliNumber: "7106807",
          title: "Way Maker",
          author: "Osinachi Kalu Okoro Egbu",
          copyright: "2016 Sinach (Admin. by SLIC Inspire)",
          key: "E",
          lyricsPreview:
            "You are here moving in our midst\nI worship You I worship You\nYou are here working in this place\nI worship You I worship You\nWay Maker Miracle Worker\nPromise Keeper Light in the darkness",
          themes: ["Faithfulness", "Miracles", "God's Presence"],
        },
        {
          ccliNumber: "7147798",
          title: "Graves Into Gardens",
          author: "Brandon Lake, Chris Brown, Steven Furtick, Tiffany Hudson",
          copyright: "2019 Music by Elevation Worship Publishing",
          key: "B",
          lyricsPreview:
            "I searched the world but it couldn't fill me\nMan's empty praise and treasures that fade\nAre never enough\nThen You came along and You put me back together\nAnd every desire is now satisfied\nHere in Your love",
          themes: ["Restoration", "Grace", "Joy", "Salvation"],
        },
        {
          ccliNumber: "7037787",
          title: "Build My Life",
          author: "Brett Younker, Karl Martin, Kirby Kaple, Matt Redman, Pat Barrett",
          copyright: "2016 Said And Done Music / sixsteps Music",
          key: "G",
          lyricsPreview:
            "Worthy of ev'ry song we could ever sing\nWorthy of all the praise we could ever bring\nWorthy of ev'ry breath we could ever breathe\nWe live for You",
          themes: ["Dedication", "Holiness", "Praise"],
        },
      ];

      const filtered = mockDatabase.filter(
        (s) =>
          s.title.toLowerCase().includes(term) ||
          s.author.toLowerCase().includes(term) ||
          s.ccliNumber.includes(term)
      );

      setResults(filtered.length > 0 ? filtered : mockDatabase);
      setIsSearching(false);
    }, 350);
  };

  const handleSelect = (song: SongSelectResult) => {
    setSelectedSong(song);
  };

  const handleImport = (song: SongSelectResult) => {
    onImportSong(song);
    setImportedIds(new Set([...importedIds, song.ccliNumber]));
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(4px)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        className="card"
        style={{
          width: "900px",
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
                CCLI SongSelect® Lyric Search & Import
              </h2>
              <span className="mono" style={{ fontSize: 12, color: "#9CA3AF" }}>
                Active License #{ccliLicenseNumber} • Auto Reporting Enabled
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn"
            style={{ padding: "6px 8px", background: "transparent", border: "none" }}
          >
            <X size={20} color="#9CA3AF" />
          </button>
        </div>

        {/* Search Bar */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #1F2937", background: "#131C2E" }}>
          <form onSubmit={handleSearch} style={{ display: "flex", gap: 10 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <Search
                size={18}
                color="#9CA3AF"
                style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}
              />
              <input
                type="text"
                placeholder="Search by song title, author, lyric fragment, or CCLI #..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
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
        </div>

        {/* Content Body */}
        <div style={{ display: "flex", flex: 1, minHeight: 400, overflow: "hidden" }}>
          {/* Results List */}
          <div
            style={{
              width: "48%",
              borderRight: "1px solid #1F2937",
              overflowY: "auto",
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {results.length === 0 ? (
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
                  Type a song name above to search the CCLI catalog.
                </p>
              </div>
            ) : (
              results.map((song) => {
                const isSelected = selectedSong?.ccliNumber === song.ccliNumber;
                const isImported = importedIds.has(song.ccliNumber);
                return (
                  <div
                    key={song.ccliNumber}
                    onClick={() => handleSelect(song)}
                    style={{
                      padding: "12px 14px",
                      borderRadius: 8,
                      backgroundColor: isSelected ? "#1E3A8A" : "#1F2937",
                      border: `1px solid ${isSelected ? "#3B82F6" : "#374151"}`,
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <span style={{ fontWeight: 700, fontSize: 15, color: "#F9FAFB" }}>{song.title}</span>
                      <span
                        className="mono"
                        style={{
                          fontSize: 11,
                          padding: "2px 6px",
                          borderRadius: 4,
                          backgroundColor: "#111827",
                          color: "#9CA3AF",
                        }}
                      >
                        CCLI #{song.ccliNumber}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: "#D1D5DB", marginTop: 4 }}>{song.author}</div>
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
                      <span>Key: {song.key}</span>
                      {isImported && (
                        <span style={{ color: "#34D399", display: "flex", alignItems: "center", gap: 4 }}>
                          <CheckCircle size={12} /> Imported
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Song Preview Details */}
          <div style={{ flex: 1, padding: 20, overflowY: "auto", display: "flex", flexDirection: "column" }}>
            {selectedSong ? (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: "#F9FAFB" }}>
                      {selectedSong.title}
                    </h3>
                    <div style={{ fontSize: 13, color: "#9CA3AF", marginTop: 4 }}>
                      By {selectedSong.author}
                    </div>
                  </div>
                  <button
                    onClick={() => handleImport(selectedSong)}
                    disabled={importedIds.has(selectedSong.ccliNumber)}
                    className="btn"
                    style={{
                      height: 40,
                      padding: "0 16px",
                      backgroundColor: importedIds.has(selectedSong.ccliNumber) ? "#065F46" : "#0284C7",
                      borderColor: importedIds.has(selectedSong.ccliNumber) ? "#059669" : "#0369A1",
                      color: "#FFFFFF",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    {importedIds.has(selectedSong.ccliNumber) ? (
                      <>
                        <CheckCircle size={16} /> Added to Library
                      </>
                    ) : (
                      <>
                        <Download size={16} /> Import to Slides
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
                  <div>CCLI Song #: {selectedSong.ccliNumber}</div>
                  <div>Copyright: {selectedSong.copyright}</div>
                  <div>Original Key: {selectedSong.key}</div>
                </div>

                <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#9CA3AF", marginBottom: 8 }}>
                    LYRICS PREVIEW
                  </span>
                  <div
                    style={{
                      flex: 1,
                      padding: 14,
                      borderRadius: 8,
                      backgroundColor: "#1F2937",
                      border: "1px solid #374151",
                      whiteSpace: "pre-line",
                      fontSize: 14,
                      lineHeight: "1.6",
                      color: "#F3F4F6",
                      fontFamily: "inherit",
                    }}
                  >
                    {selectedSong.lyricsPreview}
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
                }}
              >
                Select a song on the left to preview lyrics and license details.
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
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#9CA3AF", fontSize: 12 }}>
            <Key size={14} />
            <span>Reporting complies with CCLI Church Copyright License terms.</span>
          </div>
          <button onClick={onClose} className="btn" style={{ height: 36, padding: "0 16px" }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
