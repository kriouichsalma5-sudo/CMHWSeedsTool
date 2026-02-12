import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import "./styles.css";

// ===============================================
// CONSTANTS & HELPERS
// ===============================================
const ANALYZER_COLORS = [
  "#3498db",
  "#2ecc71",
  "#e74c3c",
  "#f1c40f",
  "#9b59b6",
  "#1abc9c",
  "#e67e22",
  "#34495e",
];

const ipv4Regex =
  /(?:(?:25[0-5]|2[0-4]\d|1?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|1?\d{1,2})/;

const getInitialTheme = () => {
  if (typeof window !== "undefined" && window.localStorage) {
    const storedTheme = window.localStorage.getItem("theme");
    if (storedTheme) return storedTheme;
    if (window.matchMedia("(prefers-color-scheme: dark)").matches)
      return "dark";
  }
  return "light";
};

// Text download (kept only for TXT exports)
const downloadText = (
  text,
  filename = "data.txt",
  mimeType = "text/plain;charset=utf-8"
) => {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

// NEW: XLSX Export using SheetJS
const exportToXLSX = (rows, filename = "export.xlsx") => {
  // Dynamically load SheetJS if not already loaded
  if (!window.XLSX) {
    const script = document.createElement("script");
    script.src =
      "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    script.onload = () => performExport(rows, filename);
    script.onerror = () => alert("Failed to load XLSX library");
    document.body.appendChild(script);
  } else {
    performExport(rows, filename);
  }

  function performExport(rows, filename) {
    const ws = window.XLSX.utils.json_to_sheet(rows);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    window.XLSX.writeFile(wb, filename);
  }
};

const readFileContent = (file, callback) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    let text = e.target.result;

    // If it's XLSX, we need SheetJS to parse it
    if (
      file.name.toLowerCase().endsWith(".xlsx") ||
      file.name.toLowerCase().endsWith(".xls")
    ) {
      if (!window.XLSX) {
        // Load SheetJS dynamically if not already loaded
        const script = document.createElement("script");
        script.src =
          "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
        script.onload = () => parseXLSX(text, callback);
        script.onerror = () => callback("Failed to load XLSX parser");
        document.body.appendChild(script);
      } else {
        parseXLSX(text, callback);
      }
    } else {
      // TXT / CSV / LOG → treat as plain text
      callback(text);
    }
  };

  // Read as binary for XLSX reliability
  if (file.name.toLowerCase().match(/\.(xlsx|xls)$/)) {
    reader.readAsBinaryString(file);
  } else {
    reader.readAsText(file);
  }
};

const parseXLSX = (binary, callback) => {
  try {
    const workbook = window.XLSX.read(binary, { type: "binary" });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    // Use sheet_to_json with header:1 → treats all rows as data (no header)
    const jsonData = window.XLSX.utils.sheet_to_json(worksheet, {
      header: 1, // Row 1 becomes data (skip if you have headers)
      defval: "", // Empty cells = empty string
      blankrows: false, // Skip completely empty rows
      raw: false, // Convert numbers/dates to strings
    });

    // Filter out empty rows and reconstruct each row as a space-separated line
    const lines = jsonData
      .filter((row) => row.some((cell) => cell !== "" && cell !== null)) // Skip fully empty rows
      .map(
        (row) =>
          row
            .map((cell) => String(cell || "").trim())
            .filter((cell) => cell !== "") // Optional: remove empty columns if needed
            .join(" ") // Join all columns with single space
      );

    if (lines.length === 0) {
      callback("No data found in the Excel file.");
      return;
    }

    callback(lines.join("\n"));
  } catch (err) {
    console.error("XLSX parse error:", err);
    callback(
      "Error parsing XLSX file. The file may be corrupted or password-protected."
    );
  }
};
const handleFileUpload = (event, setter) => {
  const file = event.target.files?.[0];
  if (!file) return;

  readFileContent(file, (result) => {
    if (
      (typeof result === "string" && result.startsWith("Error")) ||
      result.startsWith("Failed")
    ) {
      alert(result);
      return;
    }
    setter(result);
  });

  // Clear input
  event.target.value = null;
};

// ===============================================
// 🔒 STABLE INPUT / TEXTAREA FIX (GLOBAL)
// ===============================================
const useStableInput = (value, setValue) => {
  const ref = useRef(null);

  const onChange = useCallback(
    (e) => {
      const el = e.target;
      const cursor = el.selectionStart;
      const nextValue = el.value;

      setValue(nextValue);

      requestAnimationFrame(() => {
        if (ref.current) {
          ref.current.focus();
          ref.current.setSelectionRange(cursor, cursor);
        }
      });
    },
    [setValue]
  );

  return { ref, value, onChange };
};

// ===============================================
// MAIN APP COMPONENT
// ===============================================
export default function App() {
  const [theme, setTheme] = useState(getInitialTheme);
  const [selectedTab, setSelectedTab] = useState("analyzer");
  const [selectedLogSubTab, setSelectedLogSubTab] = useState("newsletter");
  const commonFileInputRef = useRef(null);

  useEffect(() => {
    document.body.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  // ===============================================
  // 1. Newsletter Log Analyzer - FULLY FIXED FOR BOTH FORMATS
  // ===============================================
  const [analyzerInput, setAnalyzerInput] = useState("");
  const [analyzerOutput, setAnalyzerOutput] = useState({});
  const [sortedUrls, setSortedUrls] = useState([]);
  const [chartData, setChartData] = useState([]);
  const [analyzerError, setAnalyzerError] = useState("");
  const analyzerCtrl = useStableInput(analyzerInput, setAnalyzerInput);

  const cleanLines = (text) =>
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

  // FIXED: Extract from OLD iMacros format (handles quotes, multiple commas, dates)
  const extractFromOldFormat = (line) => {
    let cleaned = line.trim();

    // Remove surrounding quotes if present
    if (
      (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'"))
    ) {
      cleaned = cleaned.slice(1, -1).trim();
    }

    // Find the first comma that separates profile ID from the rest
    const firstComma = cleaned.indexOf(",");
    if (firstComma === -1) return null;

    const profilePart = cleaned.substring(0, firstComma).trim();
    const messagePart = cleaned.substring(firstComma + 1).trim();

    // Validate profile is a number
    if (!/^\d+$/.test(profilePart)) return null;

    const profile = profilePart;

    // Extract URL: look for http(s):// followed by non-space chars
    const urlMatch = messagePart.match(/(https?:\/\/[^\s"'(),;]+)/i);
    if (!urlMatch) return null;

    let url = urlMatch[1].trim();

    // Clean trailing punctuation and quotes
    url = url.replace(/["',.;\)]*$/, "");
    url = url.replace(/\/+$/, ""); // remove trailing slashes

    return { profile, url };
  };

  // Extract from NEW Webautomat format (multi-line)
  const extractFromNewFormat = (lines, startIndex) => {
    if (lines.length < startIndex + 4) {
      return { extracted: [], nextIndex: startIndex };
    }

    const profileLine = lines[startIndex].trim();
    const completedLine = lines[startIndex + 1].trim();
    const trackingLine = lines[startIndex + 2].trim();
    const resultsLine = lines[startIndex + 3].trim();

    if (
      !/^\d+$/.test(profileLine) ||
      completedLine !== "Completed" ||
      !trackingLine.includes("NewsLettersWithTracking")
    ) {
      return { extracted: [], nextIndex: startIndex + 1 };
    }

    const profile = profileLine;
    const extracted = [];

    // Split by semicolon, handle leading/trailing spaces and empty parts
    const parts = resultsLine
      .split(";")
      .map((p) => p.trim())
      .filter((p) => p.includes(":"));

    parts.forEach((part) => {
      const domain = part.split(":")[0].trim();
      if (!domain) return;

      let url = domain.toLowerCase();
      if (!url.startsWith("http")) {
        url = "https://" + url;
      }
      url = url.replace(/\/+$/, "");

      extracted.push({ profile, url });
    });

    return { extracted, nextIndex: startIndex + 4 };
  };

  const processLogs = () => {
    setAnalyzerError("");
    setAnalyzerOutput({});
    setSortedUrls([]);
    setChartData([]);

    if (!analyzerInput.trim()) {
      setAnalyzerError("Please paste or upload the newsletter log content.");
      return;
    }

    const lines = cleanLines(analyzerInput);
    if (lines.length === 0) {
      setAnalyzerError("No valid lines found after cleaning.");
      return;
    }

    const result = {}; // { url: [profiles] }

    let i = 0;
    while (i < lines.length) {
      const currentLine = lines[i];

      // First: try old iMacros format
      const oldMatch = extractFromOldFormat(currentLine);
      if (oldMatch) {
        const { profile, url } = oldMatch;
        if (!result[url]) result[url] = [];
        if (!result[url].includes(profile)) result[url].push(profile);
        i++;
        continue;
      }

      // Then: try new Webautomat format (4 lines)
      const newMatch = extractFromNewFormat(lines, i);
      if (newMatch.extracted.length > 0) {
        newMatch.extracted.forEach(({ profile, url }) => {
          if (!result[url]) result[url] = [];
          if (!result[url].includes(profile)) result[url].push(profile);
        });
        i = newMatch.nextIndex;
        continue;
      }

      // Skip unrecognized line
      i++;
    }

    if (Object.keys(result).length === 0) {
      setAnalyzerError(
        "No newsletter subscriptions detected. Please check if logs match one of the supported formats."
      );
      return;
    }

    const sorted = Object.keys(result).sort((a, b) => a.localeCompare(b));
    setSortedUrls(sorted);
    setAnalyzerOutput(result);

    const chartArray = sorted.map((url) => ({
      name: url.length > 50 ? url.substring(0, 47) + "..." : url,
      value: result[url].length,
      fullUrl: url,
    }));
    setChartData(chartArray);
  };

  const handleAnalyzerFileChange = (event) => {
    handleFileUpload(event, (text) => {
      setAnalyzerInput(text);
      setAnalyzerError("");
      processLogs(); // auto-process like before
    });
  };

  const handleAnalyzerInput = (e) => {
    setAnalyzerInput(e.target.value);
    setAnalyzerError("");
  };

  const exportAllAnalyzerXLSX = () => {
    if (Object.keys(analyzerOutput).length === 0) return;
    const rows = [];
    sortedUrls.forEach((url) => {
      analyzerOutput[url].forEach((profile) => {
        rows.push({ Newsletter_URL: url, Profile_ID: profile });
      });
    });
    exportToXLSX(rows, "newsletter_subscriptions.xlsx");
  };

  const renderColorfulLegendText = (value, entry) => {
    const totalProfiles = chartData.reduce((sum, d) => sum + d.value, 0);
    const percentage = ((entry.payload.value / totalProfiles) * 100).toFixed(1);
    return (
      <span
        style={{ color: entry.color, fontSize: "0.9rem", margin: "0 8px" }}
        title={entry.payload.fullUrl}
      >
        {value} ({entry.payload.value} - {percentage}%)
      </span>
    );
  };

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      return (
        <div className="custom-tooltip">
          <p className="label">{payload[0].payload.fullUrl}</p>
          <p className="intro">{`Subscribed Profiles: ${payload[0].value}`}</p>
        </div>
      );
    }
    return null;
  };
  const NewsletterLogAnalyzer = () => (
    <>
      <div className="tab-header">
        <h1>Newsletter Log Analyzer</h1>
      </div>
      <p className="muted">
        <strong>Supports both formats ( iMacros log + Webautomat log ):</strong>
      </p>

      <div className="controls-analyzer">
        <div className="control-col">
          <label className="label">Paste your log here :</label>
          <textarea
            ref={analyzerCtrl.ref}
            className="input-area"
            rows={12}
            value={analyzerCtrl.value}
            onChange={analyzerCtrl.onChange}
            placeholder={`iMacros format:\nProfile,Inscription successful in this account https://......,15-04-2025 13-2\n\nWebautomat  format:\nProfile\nCompleted\nNewsLettersWithTracking [Tag] ...\......com: sign up successfuly ; .....ai: sign up successfuly`}
          />
          <div className="row file-upload-row">
            <input
              type="file"
              accept=".txt,.log,.csv,.xlsx,.xls"
              onChange={handleAnalyzerFileChange}
              ref={commonFileInputRef}
              className="hidden-file-input"
            />
            {/*<button
              className="btn file-select-btn"
              onClick={() => commonFileInputRef.current?.click()}
            >
              Choose File (txt)
            </button>
            <div className="spacer" />*/}
            <button
              className="btn primary"
              onClick={processLogs}
              disabled={!analyzerInput.trim()}
            >
              Analyze Logs
            </button>
            <button
              className="btn"
              onClick={() => {
                setAnalyzerInput("");
                setAnalyzerOutput({});
                setSortedUrls([]);
                setChartData([]);
                setAnalyzerError("");
              }}
            >
              Clear
            </button>
          </div>
          {analyzerError && <div className="error">{analyzerError}</div>}
        </div>

        <div className="control-col stats">
          <h3>Analysis Summary</h3>
          {Object.keys(analyzerOutput).length > 0 ? (
            <>
              <p>
                Unique newsletters: <strong>{sortedUrls.length}</strong>
              </p>
              <p>
                Total unique profiles:{" "}
                <strong>
                  {new Set(Object.values(analyzerOutput).flat()).size}
                </strong>
              </p>
              <div className="chart-container-analyzer">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={chartData}
                      dataKey="value"
                      nameKey="name"
                      cx="40%"
                      cy="50%"
                      outerRadius={90}
                    >
                      {chartData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={ANALYZER_COLORS[index % ANALYZER_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend
                      layout="vertical"
                      align="right"
                      verticalAlign="middle"
                      formatter={renderColorfulLegendText}
                      wrapperStyle={{
                        fontSize: "0.9rem",
                        width: "60%",
                        paddingLeft: 10,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ marginTop: 30 }}>
                <button className="btn primary" onClick={exportAllAnalyzerXLSX}>
                  Export All (XLSX)
                </button>
              </div>
            </>
          ) : (
            <p className="muted">
              Paste logs and click "Analyze Logs" to see results.
            </p>
          )}
        </div>
      </div>

      {Object.keys(analyzerOutput).length > 0 && (
        <div className="parts-grid">
          {sortedUrls.map((url) => {
            const profiles = analyzerOutput[url];
            return (
              <div key={url} className="part-card">
                <div className="part-header">
                  <strong>{url}</strong>{" "}
                  <span className="part-count">
                    ({profiles.length} profiles)
                  </span>
                </div>
                <textarea className="part-area" readOnly rows={3} value={url} />
                <p
                  className="muted"
                  style={{ fontSize: "0.9rem", margin: "10px 0 5px" }}
                >
                  Subscribed Profiles:
                </p>
                <textarea
                  className="part-area"
                  readOnly
                  rows={6}
                  value={profiles.join("\n")}
                />
                <div className="card-actions-3-cols">
                  <button
                    className="btn small"
                    onClick={() => navigator.clipboard.writeText(url)}
                  >
                    Copy URL
                  </button>
                  <button
                    className="btn small"
                    onClick={() =>
                      navigator.clipboard.writeText(profiles.join("\n"))
                    }
                  >
                    Copy Profiles
                  </button>
                  <button
                    className="btn small primary"
                    onClick={() =>
                      downloadText(
                        profiles.join("\n"),
                        `${
                          url.replace(/https?:\/\//, "").split("/")[0]
                        }_profiles.txt`
                      )
                    }
                  >
                    Export TXT
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  // ===============================================
  // Log Clean Analyzer -
  // ===============================================

  // Tooltip and Legend defined OUTSIDE to fix ReferenceError
  const renderCleanLegend = (value, entry) => {
    // Note: cleanChartData is not accessible here, so we can't calculate % dynamically.
    // We'll just show the count (percentage not critical for legend)
    return (
      <span
        style={{ color: entry.color, fontSize: "0.9rem" }}
        title={entry.payload.fullStatus}
      >
        {value} ({entry.payload.value})
      </span>
    );
  };

  const CleanTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      return (
        <div className="custom-tooltip">
          <p className="label">{payload[0].payload.fullStatus}</p>
          <p className="intro">Profiles: {payload[0].value}</p>
        </div>
      );
    }
    return null;
  };

  const [cleanInput, setCleanInput] = useState("");
  const [profileRange, setProfileRange] = useState("");
  const [cleanOutput, setCleanOutput] = useState({});
  const [missingProfiles, setMissingProfiles] = useState([]);
  const [cleanChartData, setCleanChartData] = useState([]);
  const [cleanError, setCleanError] = useState("");
  const [parsedEntries, setParsedEntries] = useState([]);
  const cleanCtrl = useStableInput(cleanInput, setCleanInput);

  const profileRangeCtrl = useStableInput(profileRange, setProfileRange);

  const [profileListInput, setProfileListInput] = useState("");
  const profileListCtrl = useStableInput(profileListInput, setProfileListInput);

  // Normalize status for grouping
  const normalizeStatus = (status) => {
    return status.trim().toLowerCase().replace(/_/g, " ");
  };

  // Parse each log line
  const parseCleanLogLine = (line) => {
    const parts = line.split(",");
    if (parts.length < 5) return null;
    const session = parts[0].trim();
    const profileStr = parts[1].trim();
    const status = parts[2].trim();
    const email = parts[3].trim();
    const dateTime = parts.slice(4).join(",").trim();
    const profile = parseInt(profileStr, 10);
    if (isNaN(profile)) return null;
    return {
      session,
      profile,
      status: status.trim(),
      normalizedStatus: normalizeStatus(status),
      email,
      dateTime,
      fullLine: line.trim(),
    };
  };

  // Parse multiple ranges: "1-800 + 2701-3120"
  const parseProfileRanges = (input) => {
    const rangeParts = input
      .split("+")
      .map((p) => p.trim())
      .filter(Boolean);
    const allProfiles = new Set();

    for (const part of rangeParts) {
      const match = part.match(/^(\d+)\s*[-–]\s*(\d+)$/);
      if (!match) {
        throw new Error(`Invalid range format: "${part}". Use: start-end`);
      }
      const start = parseInt(match[1], 10);
      const end = parseInt(match[2], 10);
      if (start > end) {
        throw new Error(`Start > end in range: ${part}`);
      }
      for (let p = start; p <= end; p++) {
        allProfiles.add(p);
      }
    }

    return {
      allProfiles: Array.from(allProfiles).sort((a, b) => a - b),
    };
  };
  // Parse explicit profiles list: "4501, 4502\n4503"
  const parseProfileList = (input) => {
    return input
      .split(/[\s,]+/)
      .map((v) => v.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => !isNaN(n));
  };

  const processCleanLogs = () => {
    setCleanError("");
    setCleanOutput({});
    setMissingProfiles([]);
    setCleanChartData([]);
    setParsedEntries([]);

    if (!cleanInput.trim()) {
      setCleanError("Please paste the log content.");
      return;
    }

    let rangeProfiles = null;
    let listProfiles = null;

    // Parse ranges if provided
    if (profileRange.trim()) {
      try {
        rangeProfiles = new Set(parseProfileRanges(profileRange).allProfiles);
      } catch (err) {
        setCleanError(err.message);
        return;
      }
    }

    // Parse explicit profile list if provided
    if (profileListInput.trim()) {
      const parsedList = parseProfileList(profileListInput);
      if (parsedList.length === 0) {
        setCleanError("Profile list is invalid or empty.");
        return;
      }
      listProfiles = new Set(parsedList);
    }

    // Decide final target profiles
    let targetProfiles;

    if (rangeProfiles && listProfiles) {
      // Intersection
      targetProfiles = new Set(
        [...listProfiles].filter((p) => rangeProfiles.has(p))
      );
    } else if (rangeProfiles) {
      targetProfiles = rangeProfiles;
    } else if (listProfiles) {
      targetProfiles = listProfiles;
    } else {
      setCleanError("Please enter Profile Range or Profile List.");
      return;
    }

    const lines = cleanInput
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const allEntries = [];

    for (const line of lines) {
      const entry = parseCleanLogLine(line);
      if (entry && targetProfiles.has(entry.profile)) {
        allEntries.push(entry);
      }
    }

    if (allEntries.length === 0) {
      setCleanError(
        `No profiles found in the specified range(s): ${profileRange}`
      );
      return;
    }

    // Deduplicate: keep latest per profile
    const uniqueMap = new Map();
    allEntries.forEach((entry) => {
      uniqueMap.set(entry.profile, entry);
    });
    const uniqueEntries = Array.from(uniqueMap.values());
    setParsedEntries(uniqueEntries);

    // Group by status
    const grouped = {};
    uniqueEntries.forEach((entry) => {
      const key = entry.normalizedStatus || "unknown";
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(entry);
    });

    const sortedStatuses = Object.keys(grouped).sort(
      (a, b) => grouped[b].length - grouped[a].length
    );

    const sortedGrouped = {};
    sortedStatuses.forEach((status) => {
      sortedGrouped[status] = grouped[status];
    });
    setCleanOutput(sortedGrouped);

    // Missing profiles
    const present = new Set(uniqueEntries.map((e) => e.profile));
    const missing = [...targetProfiles]
      .filter((p) => !present.has(p))
      .map(String);

    setMissingProfiles(missing);

    // Chart data
    const chartArray = sortedStatuses.map((status) => {
      const displayName =
        status.length > 30 ? status.substring(0, 27) + "..." : status;
      const originalStatus = grouped[status][0]?.status || status;
      return {
        name: displayName,
        value: grouped[status].length,
        fullStatus: originalStatus,
      };
    });
    setCleanChartData(chartArray);
  };

  // Export full results as XLSX
  const exportStatusXLSX = () => {
    if (Object.keys(cleanOutput).length === 0) return;
    const rows = [];
    Object.values(cleanOutput)
      .flat()
      .forEach((entry) => {
        rows.push({
          Session: entry.session,
          Profile: entry.profile,
          Status: entry.status,
          Email: entry.email,
          DateTime: entry.dateTime,
        });
      });
    exportToXLSX(rows, "clean_log_results.xlsx");
  };

  const exportMissingTXT = () => {
    downloadText(missingProfiles.join("\n"), "missing_profiles.txt");
  };

  const LogCleanAnalyzer = () => (
    <>
      <div className="tab-header">
        <h1>Log Clean Analyzer</h1>
      </div>
      <p className="muted">
        Analyzes session logs: filters by one or more profile ranges, removes
        duplicates,
        <br />
        groups by status with <strong>separate profiles & emails</strong> for
        easy copying.
      </p>

      <div className="controls-analyzer">
        <div className="control-col">
          <label className="label">Paste logs here:</label>
          <textarea
            placeholder="session,profile,status,email,date hour"
            ref={cleanCtrl.ref}
            className="input-area"
            rows={10}
            value={cleanCtrl.value}
            onChange={cleanCtrl.onChange}
          />

          <div
            className="row"
            style={{
              marginTop: 15,
              alignItems: "center",
              flexWrap: "wrap",
              gap: "10px",
            }}
          >
            <label
              className="label"
              style={{ margin: 0, marginRight: 10, minWidth: "120px" }}
            >
              Profile Range(s):
            </label>
            <input
              ref={profileRangeCtrl.ref}
              className="small-input"
              value={profileRangeCtrl.value}
              onChange={profileRangeCtrl.onChange}
              style={{
                width: "280px",
                padding: "10px 12px",
                borderRadius: "8px",
                border: "4px solid var(--color-border)",
                fontSize: "0.95rem",
                backgroundColor: "transparent",
                color: "var(--color-text)",
              }}
            />
            <p className="muted" style={{ fontSize: "0.85rem", marginTop: 8 }}>
              Use + to add multiple ranges →{" "}
              <code>1-800 + 2701-3120 + 5000-5100</code>
            </p>
            <label className="label" style={{ marginTop: 10 }}>
              Profiles List (optional: commas, spaces or one per line):
            </label>
            <textarea
              ref={profileListCtrl.ref}
              className="input-area"
              rows={3}
              placeholder="commas, spaces or one per line"
              value={profileListCtrl.value}
              onChange={profileListCtrl.onChange}
            />

            <button
              className="btn primary"
              onClick={processCleanLogs}
              disabled={
                !cleanInput.trim() ||
                (!profileRange.trim() && !profileListInput.trim())
              }
            >
              Analyze Logs
            </button>
            <button
              className="btn"
              onClick={() => {
                setCleanInput("");
                setProfileRange("");
                setCleanOutput({});
                setMissingProfiles([]);
                setCleanChartData([]);
                setCleanError("");
                setParsedEntries([]);
                setProfileListInput("");
              }}
            >
              Clear
            </button>
          </div>

          {cleanError && <div className="error">{cleanError}</div>}
        </div>

        <div className="control-col stats">
          <h3>Analysis Summary</h3>
          {Object.keys(cleanOutput).length > 0 ? (
            <>
              <p>
                Profiles found: <strong>{parsedEntries.length}</strong>
              </p>
              <p>
                Unique statuses:{" "}
                <strong>{Object.keys(cleanOutput).length}</strong>
              </p>
              <p>
                Missing in range(s): <strong>{missingProfiles.length}</strong>
              </p>
              {missingProfiles.length > 0 && (
                <button
                  className="btn small primary"
                  onClick={exportMissingTXT}
                  style={{ marginTop: 10 }}
                >
                  Export Missing (TXT)
                </button>
              )}
              <div
                className="chart-container-analyzer"
                style={{ marginTop: 20 }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={cleanChartData}
                      dataKey="value"
                      nameKey="name"
                      cx="40%"
                      cy="50%"
                      outerRadius={90}
                    >
                      {cleanChartData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={ANALYZER_COLORS[index % ANALYZER_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<CleanTooltip />} />
                    <Legend
                      layout="vertical"
                      align="right"
                      verticalAlign="middle"
                      formatter={renderCleanLegend}
                      wrapperStyle={{
                        fontSize: "0.9rem",
                        width: "60%",
                        paddingLeft: 10,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ marginTop: 30 }}>
                <button className="btn primary" onClick={exportStatusXLSX}>
                  Export Full Results (XLSX)
                </button>
              </div>
            </>
          ) : (
            <p className="muted">Paste logs and set range(s) to analyze.</p>
          )}
        </div>
      </div>

      {/* Status Groups with Separate Profiles & Emails */}
      {Object.keys(cleanOutput).length > 0 && (
        <div className="parts-grid">
          {Object.keys(cleanOutput).map((normalizedStatus) => {
            const entries = cleanOutput[normalizedStatus];
            const displayStatus = entries[0]?.status || normalizedStatus;

            const profilesList = entries.map((e) => e.profile).join("\n");
            const emailsList = entries.map((e) => e.email).join("\n");
            const fullLines = entries
              .map(
                (e) =>
                  `${e.session},${e.profile},${e.status},${e.email},${e.dateTime}`
              )
              .join("\n");

            return (
              <div key={normalizedStatus} className="part-card">
                <div className="part-header">
                  <strong>{displayStatus}</strong>
                  <span className="part-count">
                    ({entries.length} profiles)
                  </span>
                </div>

                <p
                  className="muted"
                  style={{ margin: "10px 0 5px", fontSize: "0.9rem" }}
                >
                  Profiles:
                </p>
                <textarea
                  className="part-area"
                  readOnly
                  rows={6}
                  value={profilesList}
                />
                <div style={{ margin: "8px 0" }}>
                  <button
                    className="btn small"
                    onClick={() => navigator.clipboard.writeText(profilesList)}
                  >
                    Copy Profiles
                  </button>
                </div>

                <p
                  className="muted"
                  style={{ margin: "10px 0 5px", fontSize: "0.9rem" }}
                >
                  Emails:
                </p>
                <textarea
                  className="part-area"
                  readOnly
                  rows={6}
                  value={emailsList}
                />
                <div style={{ margin: "8px 0" }}>
                  <button
                    className="btn small"
                    onClick={() => navigator.clipboard.writeText(emailsList)}
                  >
                    Copy Emails
                  </button>
                </div>

                <p
                  className="muted"
                  style={{ margin: "10px 0 5px", fontSize: "0.9rem" }}
                >
                  Full Lines:
                </p>
                <textarea
                  className="part-area"
                  readOnly
                  rows={6}
                  value={fullLines}
                />
                <div className="card-actions-3-cols">
                  <button
                    className="btn small"
                    onClick={() => navigator.clipboard.writeText(displayStatus)}
                  >
                    Copy Status
                  </button>
                  <button
                    className="btn small"
                    onClick={() => navigator.clipboard.writeText(fullLines)}
                  >
                    Copy All Lines
                  </button>
                  <button
                    className="btn small primary"
                    onClick={() =>
                      downloadText(
                        fullLines,
                        `${displayStatus.replace(
                          /[^a-zA-Z0-9]/g,
                          "_"
                        )}_full.txt`
                      )
                    }
                  >
                    Export TXT
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Missing Profiles */}
      {missingProfiles.length > 0 && (
        <div
          className="part-card"
          style={{
            marginTop: 30,
            backgroundColor: "#fff0f0",
            borderColor: "#ffcccc",
          }}
        >
          <div className="part-header">
            <strong>Missing Profiles ({missingProfiles.length})</strong>
          </div>
          <textarea
            className="part-area"
            readOnly
            rows={8}
            value={missingProfiles.join("\n")}
          />
          <div className="card-actions-3-cols">
            <button
              className="btn small"
              onClick={() =>
                navigator.clipboard.writeText(missingProfiles.join("\n"))
              }
            >
              Copy All
            </button>
            <button className="btn small primary" onClick={exportMissingTXT}>
              Export TXT
            </button>
          </div>
        </div>
      )}
    </>
  );

  // ===============================================
  // Hard Bounce Analyzer - FIXED & IMPROVED
  // ===============================================
  const bounceFileInputRef = useRef(null);
  const entityFileInputRef = useRef(null);

  const [bounceInput, setBounceInput] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [excludeWord, setExcludeWord] = useState("");
  const [filteredResults, setFilteredResults] = useState([]);
  const [dateGroups, setDateGroups] = useState({});
  const [sortedDates, setSortedDates] = useState([]);
  const [bounceError, setBounceError] = useState("");
  const bounceCtrl = useStableInput(bounceInput, setBounceInput);

  // Entity List States
  const [listInput, setListInput] = useState("");
  const [entityGroups, setEntityGroups] = useState({});
  const [sortedEntities, setSortedEntities] = useState([]);
  const [listError, setListError] = useState("");
  const listCtrl = useStableInput(listInput, setListInput);

  // Stabilized handlers
  const dateFilterCtrl = useStableInput(dateFilter, setDateFilter);
  const excludeCtrl = useStableInput(excludeWord, setExcludeWord);

  const handleListInputChange = useCallback(
    (e) => setListInput(e.target.value),
    []
  );

  // Process Bounce Logs
  const processBounceLogs = () => {
    setBounceError("");
    setFilteredResults([]);
    setDateGroups({});
    setSortedDates([]);

    if (!bounceInput.trim()) {
      setBounceError("Please paste or upload bounce log content.");
      return;
    }

    const lines = bounceInput
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      setBounceError("No valid lines found.");
      return;
    }

    let filtered = lines;

    if (excludeWord.trim()) {
      const excludeTerms = excludeWord
        .split(/\r?\n/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => t.toLowerCase());

      if (excludeTerms.length > 0) {
        filtered = filtered.filter((line) => {
          const lowerLine = line.toLowerCase();
          return !excludeTerms.some((term) => lowerLine.includes(term));
        });

        if (filtered.length === 0) {
          setBounceError(
            `All lines removed by exclude filters: ${excludeTerms.join(", ")}`
          );
          return;
        }
      }
    }

    if (dateFilter.trim()) {
      const targetDate = dateFilter.trim();
      filtered = filtered.filter((line) => {
        const parts = line.split(/\s+/);
        const dateIndex = parts.findIndex((p) =>
          /^\d{2}\/\d{2}\/\d{4}$/.test(p)
        );
        return dateIndex !== -1 && parts[dateIndex] === targetDate;
      });
      if (filtered.length === 0) {
        setBounceError(`No entries found for date: ${targetDate}`);
        return;
      }
    }

    const seenEmails = new Set();
    const allResults = [];

    for (const line of filtered) {
      const emailMatch = line.match(/^([^\s]+)/);
      if (!emailMatch) continue;
      const email = emailMatch[1];
      if (seenEmails.has(email)) continue;
      seenEmails.add(email);

      const tagMatch = line.match(/\[([^\]]+)\]/);
      const tag = tagMatch ? `[${tagMatch[1]}]` : "N/A";

      const parts = line.split(/\s+/);
      const dateIndex = parts.findIndex((p) => /^\d{2}\/\d{2}\/\d{4}$/.test(p));
      const date = dateIndex !== -1 ? parts[dateIndex] : "Unknown";

      allResults.push({ email, tag, date });
    }

    if (allResults.length === 0) {
      setBounceError("No valid bounce entries found after filtering.");
      return;
    }

    if (dateFilter.trim()) {
      setFilteredResults(allResults);
    } else {
      const groups = {};
      allResults.forEach((item) => {
        const key = item.date;
        if (!groups[key]) groups[key] = [];
        groups[key].push(item);
      });

      const dates = Object.keys(groups).sort((a, b) => {
        if (a === "Unknown") return 1;
        if (b === "Unknown") return -1;
        const [d1, m1, y1] = a.split("/").map(Number);
        const [d2, m2, y2] = b.split("/").map(Number);
        return new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1);
      });

      setSortedDates(dates);
      setDateGroups(groups);
    }
  };

  // FIXED: Process Entity List - now working correctly
  const processEntityList = () => {
    setListError("");
    setEntityGroups({});
    setSortedEntities([]);

    if (!listInput.trim()) {
      setListError("Please paste the entity list.");
      return;
    }

    const lines = listInput
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      setListError("No valid lines found.");
      return;
    }

    const groups = {};
    let validCount = 0;

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) continue;

      const email = parts[0];
      // Skip session_id (parts[1])
      const session = parts[2];
      const emailOrder = parts[3];

      const entity = session.split("_")[0];
      if (!/^CMH\d+$/.test(entity)) continue;

      const row = { email, session, emailOrder, entity };

      if (!groups[entity]) groups[entity] = [];
      groups[entity].push(row);
      validCount++;
    }

    if (validCount === 0) {
      setListError(
        "No valid entries found. Expected format: email session_id session email_order"
      );
      return;
    }

    const sorted = Object.keys(groups).sort((a, b) => {
      return groups[b].length - groups[a].length || a.localeCompare(b);
    });

    setSortedEntities(sorted);
    setEntityGroups(groups);
  };

  // Export functions
  const exportDateGroupTXT = (date) => {
    const group = dateGroups[date] || [];
    const txt = group
      .map((r) => `${r.email} | ${r.tag} | ${r.date}`)
      .join("\n");
    downloadText(txt, `bounces_${date.replace(/\//g, "-")}.txt`);
  };

  const exportDateGroupXLSX = (date) => {
    const group = dateGroups[date] || [];
    const rows = group.map((r) => ({
      Email: r.email,
      Tag: r.tag,
      Date: r.date,
    }));
    exportToXLSX(rows, `bounces_${date.replace(/\//g, "-")}.xlsx`);
  };

  const exportAllDatesXLSX = () => {
    const rows = [];
    sortedDates.forEach((date) => {
      dateGroups[date].forEach((r) => {
        rows.push({ Email: r.email, Tag: r.tag, Date: r.date });
      });
    });
    exportToXLSX(rows, "all_bounces_by_date.xlsx");
  };
  const exportResultsTXT = () => {
    const txt = filteredResults
      .map((r) => `${r.email} | ${r.tag} | ${r.date}`)
      .join("\n");
    downloadText(txt, "filtered_bounces.txt");
  };

  const exportResultsXLSX = () => {
    const rows = filteredResults.map((r) => ({
      Email: r.email,
      Tag: r.tag,
      Date: r.date,
    }));
    exportToXLSX(rows, "filtered_bounces.xlsx");
  };

  const exportEntityGroupTXT = (entity) => {
    const group = entityGroups[entity] || [];
    const txt = group
      .map((r) => `${r.email} ${r.session} ${r.emailOrder} ${r.entity}`)
      .join("\n");
    downloadText(txt, `${entity}_list.txt`);
  };

  const exportEntityGroupXLSX = (entity) => {
    const group = entityGroups[entity] || [];
    const rows = group.map((r) => ({
      email: r.email,
      session: r.session,
      email_order: r.emailOrder,
      entity: r.entity,
    }));
    exportToXLSX(rows, `${entity}_list.xlsx`);
  };

  const exportAllEntitiesXLSX = () => {
    const rows = [];
    sortedEntities.forEach((entity) => {
      entityGroups[entity].forEach((r) => {
        rows.push({
          email: r.email,
          session: r.session,
          email_order: r.emailOrder,
          entity: r.entity,
        });
      });
    });
    exportToXLSX(rows, "all_entities_combined.xlsx");
  };

  // File handlers

  const handleBounceFileChange = (event) => {
    handleFileUpload(event, (text) => {
      setBounceInput(text);
      setBounceError("");
    });
  };

  const handleListFileChange = (event) => {
    handleFileUpload(event, (text) => {
      setListInput(text);
      setListError("");
    });
  };

  // Updated HardBounceAnalyzer component
  const HardBounceAnalyzer = () => (
    <>
      <div className="tab-header">
        <h1>Hard Bounce Analyzer</h1>
      </div>
      <p className="muted">
        <strong>1.</strong> Filter bounce logs → Email | Tag | Date
        <br />
        <strong>2.</strong> Parse list from search emails(EmailSession) → Group
        by entity (CMH1, CMH2...)
      </p>

      <div className="controls-analyzer">
        {/* Bounce Logs Section */}
        <div className="control-col">
          <h3 style={{ marginTop: 0, color: "var(--color-primary)" }}>
            Bounce Logs
          </h3>
          <label className="label">Paste bounce logs:</label>
          <textarea
            ref={bounceCtrl.ref}
            className="input-area"
            rows={8}
            value={bounceCtrl.value}
            onChange={bounceCtrl.onChange}
            placeholder="email@gmail.com [TAG] ... 30/12/2025"
          />

          <div className="row file-upload-row" style={{ marginTop: 10 }}>
            <input
              type="file"
              accept=".txt,.log,.csv,.xlsx,.xls"
              onChange={handleBounceFileChange}
              ref={bounceFileInputRef}
              className="hidden-file-input"
            />
            {/*
<button
  className="btn file-select-btn"
  onClick={() => bounceFileInputRef.current?.click()}
>
  Choose File (txt)
</button>

            <div className="spacer" />*/}
            <button
              className="btn primary"
              onClick={processBounceLogs}
              disabled={!bounceInput.trim()}
            >
              Analyze Bounce Logs
            </button>
            <button
              className="btn"
              onClick={() => {
                setBounceInput("");
                setDateFilter("");
                setExcludeWord("");
                setFilteredResults([]);
                setDateGroups({});
                setSortedDates([]);
                setBounceError("");
              }}
            >
              Clear
            </button>
          </div>

          <div
            className="row"
            style={{ marginTop: 15, gap: 15, flexWrap: "wrap" }}
          >
            <div style={{ flex: "1 1 280px", maxWidth: 320 }}>
              <label className="label">Date Filter (optional):</label>
              <input
                ref={dateFilterCtrl.ref}
                className="small-input"
                value={dateFilterCtrl.value}
                onChange={dateFilterCtrl.onChange}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  border: "4px solid var(--color-border)",
                  fontSize: "0.95rem",
                  background: "transparent",
                  color: "var(--color-text)",
                }}
                autoComplete="off"
              />
            </div>

            {/* NEW MULTI-LINE EXCLUDE */}
            <div style={{ flex: "1 1 280px", maxWidth: 420 }}>
              <label className="label">
                Exclude Words/Phrases (one per line):
              </label>
              <textarea
                ref={excludeCtrl.ref}
                value={excludeCtrl.value}
                onChange={excludeCtrl.onChange}
                style={{
                  width: "100%",
                  height: "120px",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  border: "4px solid var(--color-border)",
                  fontSize: "0.95rem",
                  background: "transparent",
                  color: "var(--color-text)",
                  resize: "vertical",
                }}
                autoComplete="off"
              />
              <p
                className="muted"
                style={{ fontSize: "0.85rem", marginTop: 5 }}
              >
                Lines containing any of these words/phrases will be removed
              </p>
            </div>
          </div>

          <p className="muted" style={{ fontSize: "0.85rem", marginTop: 10 }}>
            Leave date filter empty → results grouped by date
          </p>
        </div>

        {/* Entity List Parser */}
        <div className="control-col">
          <h3 style={{ marginTop: 0, color: "var(--color-primary)" }}>
            Entity List Parser
          </h3>
          <label className="label">Paste list:</label>
          <textarea
            ref={listCtrl.ref}
            className="input-area"
            rows={8}
            value={listCtrl.value}
            onChange={listCtrl.onChange}
            placeholder="email session_id session email_order"
          />

          <div className="row file-upload-row" style={{ marginTop: 10 }}>
            <input
              type="file"
              accept=".txt,.csv,.xlsx,.xls"
              onChange={handleListFileChange}
              ref={entityFileInputRef}
              className="hidden-file-input"
            />
            {/*<button
              className="btn file-select-btn"
              onClick={() => entityFileInputRef.current?.click()}
            >
              Choose File (txt)
            </button>
            <div className="spacer" />*/}
            <button
              className="btn primary"
              onClick={processEntityList}
              disabled={!listInput.trim()}
            >
              Parse by Entity
            </button>
            <button
              className="btn"
              onClick={() => {
                setListInput("");
                setEntityGroups({});
                setSortedEntities([]);
                setListError("");
              }}
            >
              Clear
            </button>
          </div>

          {listError && <div className="error">{listError}</div>}
        </div>
      </div>
      {/* Bounce Results: Grouped by Date */}
      {sortedDates.length > 0 && (
        <div className="parts-grid">
          {sortedDates.map((date) => {
            const group = dateGroups[date];
            const lines = group
              .map((r) => `${r.email} | ${r.tag} | ${r.date}`)
              .join("\n");

            return (
              <div key={date} className="part-card">
                <div className="part-header">
                  <strong>{date === "Unknown" ? "Unknown Date" : date}</strong>
                  <span className="part-count">({group.length} emails)</span>
                </div>
                <textarea
                  className="part-area"
                  readOnly
                  rows={10}
                  value={lines}
                />
                <div className="card-actions-3-cols">
                  <button
                    className="btn small"
                    onClick={() => navigator.clipboard.writeText(lines)}
                  >
                    Copy
                  </button>
                  <button
                    className="btn small"
                    onClick={() => exportDateGroupTXT(date)}
                  >
                    Ewport TXT
                  </button>
                  <button
                    className="btn small primary"
                    onClick={() => exportDateGroupXLSX(date)}
                  >
                    Export XLSX
                  </button>
                </div>
              </div>
            );
          })}

          <div
            className="part-card"
            style={{ background: "var(--color-bg-secondary)" }}
          >
            <div className="part-header">
              <strong>
                All Dates Combined ({Object.values(dateGroups).flat().length}{" "}
                total)
              </strong>
            </div>
            <div
              className="card-actions-3-cols"
              style={{ padding: "15px", justifyContent: "center" }}
            >
              <button className="btn primary" onClick={exportAllDatesXLSX}>
                Export All XLSX
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bounce Results: Single List (filtered) */}
      {filteredResults.length > 0 && sortedDates.length === 0 && (
        <div className="parts-grid">
          <div className="part-card" style={{ width: "100%" }}>
            <div className="part-header">
              <strong>
                Bounce Results ({filteredResults.length} unique emails)
              </strong>
              {dateFilter.trim() && (
                <span style={{ marginLeft: 10, opacity: 0.8 }}>
                  — Filtered: {dateFilter}
                </span>
              )}
            </div>
            <textarea
              className="part-area"
              readOnly
              rows={12}
              value={filteredResults
                .map((r) => `${r.email} | ${r.tag} | ${r.date}`)
                .join("\n")}
            />
            <div className="card-actions-3-cols">
              <button
                className="btn small"
                onClick={() =>
                  navigator.clipboard.writeText(
                    filteredResults
                      .map((r) => `${r.email} | ${r.tag} | ${r.date}`)
                      .join("\n")
                  )
                }
              >
                Copy All
              </button>
              <button className="btn small" onClick={exportResultsTXT}>
                TXT
              </button>
              <button className="btn small primary" onClick={exportResultsXLSX}>
                XLSX
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Entity Results */}
      {sortedEntities.length > 0 && (
        <div className="parts-grid">
          {sortedEntities.map((entity) => {
            const group = entityGroups[entity];
            const lines = group
              .map((r) => `${r.email} ${r.session} ${r.emailOrder} ${r.entity}`)
              .join("\n");

            return (
              <div key={entity} className="part-card">
                <div className="part-header">
                  <strong>{entity}</strong>
                  <span className="part-count">({group.length} emails)</span>
                </div>
                <textarea
                  className="part-area"
                  readOnly
                  rows={Math.min(12, group.length + 2)}
                  value={lines}
                />
                <div className="card-actions-3-cols">
                  <button
                    className="btn small"
                    onClick={() => navigator.clipboard.writeText(lines)}
                  >
                    Copy
                  </button>
                  <button
                    className="btn small"
                    onClick={() => exportEntityGroupTXT(entity)}
                  >
                    TXT
                  </button>
                  <button
                    className="btn small primary"
                    onClick={() => exportEntityGroupXLSX(entity)}
                  >
                    XLSX
                  </button>
                </div>
              </div>
            );
          })}
          <div
            className="part-card"
            style={{ background: "var(--color-bg-secondary)" }}
          >
            <div className="part-header">
              <strong>
                All Entities Combined (
                {Object.values(entityGroups).flat().length} total)
              </strong>
            </div>
            <div
              className="card-actions-3-cols"
              style={{ padding: "15px", justifyContent: "center" }}
            >
              <button className="btn primary" onClick={exportAllEntitiesXLSX}>
                Export All XLSX
              </button>
            </div>
          </div>
        </div>
      )}

      {(bounceError || listError) && (
        <div className="error" style={{ marginTop: 20 }}>
          {bounceError || listError}
        </div>
      )}
    </>
  );

  // ===============================================
  // Log Analyzer Main Interface (with sub-tabs)
  // ===============================================

  const LogAnalyzerInterface = () => (
    <>
      <div className="sub-tab-container">
        <button
          className={`sub-tab-btn ${
            selectedLogSubTab === "newsletter" ? "active" : ""
          }`}
          onClick={() => setSelectedLogSubTab("newsletter")}
        >
          Newsletter Log Analyzer
        </button>

        <button
          className={`sub-tab-btn ${
            selectedLogSubTab === "clean" ? "active" : ""
          }`}
          onClick={() => setSelectedLogSubTab("clean")}
        >
          Clean Log Analyzer
        </button>

        <button
          className={`sub-tab-btn ${
            selectedLogSubTab === "hardbounce" ? "active" : ""
          }`}
          onClick={() => setSelectedLogSubTab("hardbounce")}
        >
          Hard Bounce Analyzer
        </button>
      </div>

      {selectedLogSubTab === "newsletter" && <NewsletterLogAnalyzer />}
      {selectedLogSubTab === "clean" && <LogCleanAnalyzer />}
      {selectedLogSubTab === "hardbounce" && <HardBounceAnalyzer />}
    </>
  );

  // ===============================================
  // 2. Planner State & Functions - WITH CLEAR BUTTON
  // ===============================================
  const initialActions = [
    { name: "Connect", type: "one-time", color: "#2563eb" },
    { name: "Add Birthday", type: "one-time", color: "#9333ea" },
    { name: "Add Address", type: "one-time", color: "#9333ea" },
    { name: "Language", type: "one-time", color: "#9333ea" },
    { name: "Change Picture", type: "one-time", color: "#9333ea" },
    { name: "Gender", type: "one-time", color: "#9333ea" },
    { name: "Change Template", type: "one-time", color: "#9333ea" },
    { name: "Send message", type: "repeatable", color: "#475569" },
    { name: "Forward", type: "repeatable", color: "#475569" },
    { name: "Mark Unread", type: "repeatable", color: "#475569" },
    { name: "NewsLetters With Tracking", type: "repeatable", color: "#16a34a" },
    {
      name: "Confirmation Newsletters",
      type: "repeatable",
      color: "#f97316",
      dependsOn: "NewsLetters With Tracking",
      delay: 2,
    },
    { name: "SearchWords", type: "repeatable", color: "#16a34a" },
    { name: "Search Domains Engines", type: "repeatable", color: "#16a34a" },
    { name: "Reply", type: "repeatable", color: "#475569" },
    { name: "Search Google Maps", type: "repeatable", color: "#16a34a" },
    { name: "Open Unread", type: "repeatable", color: "#475569" },
  ];

  const [sessionText, setSessionText] = useState("");
  const [plan, setPlan] = useState([]);
  const [editMode, setEditMode] = useState(false);
  const [actions, setActions] = useState(initialActions);
  const [plannerError, setPlannerError] = useState("");
  const sessionCtrl = useStableInput(sessionText, setSessionText);
  const [startDate, setStartDate] = useState("");

  const sessions = useMemo(
    () =>
      sessionText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    [sessionText]
  );

  const addAction = () => {
    setPlannerError("");
    const genericName = `New Action ${actions.length + 1}`;
    if (actions.some((a) => a.name === genericName)) return;
    const newActionItem = {
      name: genericName,
      type: "one-time",
      color: "#aaaaaa",
    };
    setActions((prev) => [...prev, newActionItem]);
  };

  const updateAction = (index, field, value) => {
    const updatedActions = [...actions];
    const actionToUpdate = updatedActions[index];
    if (
      field === "name" &&
      actions.some((a, i) => i !== index && a.name === value.trim())
    ) {
      setPlannerError(`Action name '${value.trim()}' already exists.`);
      return;
    }
    setPlannerError("");
    actionToUpdate[field] = value;
    if (field === "type" && value === "one-time") {
      delete actionToUpdate.dependsOn;
      delete actionToUpdate.delay;
    }
    setActions(updatedActions);
  };

  const removeAction = (index) => {
    setActions((prev) => prev.filter((_, i) => i !== index));
  };

  const LOCKED_DAYS = new Set([0, 1]); // Day 1 & Day 2

  const generatePlan = () => {
    setPlannerError("");
    setPlan([]);

    if (!sessions.length) {
      setPlannerError("Please paste sessions to generate a plan.");
      return;
    }

    if (!startDate) {
      setPlannerError("Please select a start date.");
      return;
    }

    const TOTAL_DAYS = 30;
    const rows = [];
    const actionMap = Object.fromEntries(actions.map((a) => [a.name, a]));
    const start = new Date(startDate);

    const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5);

    const invalidPair = (a, b) =>
      (a === "Mark Unread" && b === "Open Unread") ||
      (a === "Open Unread" && b === "Mark Unread");

    // 🔴 GLOBAL TRACKER
    const usedActionsPerDay = {};

    // Build global dates once
    const dates = [];
    for (let i = 0; i < TOTAL_DAYS; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      dates.push({
        date: d,
        isOff: customOffDays.includes(d.getDay()),
      });
    }

    sessions.forEach((session) => {
      const plan = Array(TOTAL_DAYS).fill(null);

      // ---------------------------
      // CONNECT DAY 1
      // ---------------------------
      if (!dates[0].isOff) {
        plan[0] = "Connect";
        if (!usedActionsPerDay[0]) usedActionsPerDay[0] = new Set();
        usedActionsPerDay[0].add("Connect");
      }

      // ---------------------------
      // LANGUAGE NEXT WORKDAY
      // ---------------------------
      for (let i = 1; i < TOTAL_DAYS; i++) {
        if (!dates[i].isOff) {
          plan[i] = "Language";
          if (!usedActionsPerDay[i]) usedActionsPerDay[i] = new Set();
          usedActionsPerDay[i].add("Language");
          break;
        }
      }

      // ---------------------------
      // NEWSLETTER + CONFIRMATION
      // ---------------------------
      let newsletterIndex = -1;

      for (let i = 2; i < TOTAL_DAYS; i++) {
        if (
          !dates[i].isOff &&
          !plan[i] &&
          !usedActionsPerDay[i]?.has("NewsLetters With Tracking")
        ) {
          newsletterIndex = i;
          plan[i] = "NewsLetters With Tracking";
          if (!usedActionsPerDay[i]) usedActionsPerDay[i] = new Set();
          usedActionsPerDay[i].add("NewsLetters With Tracking");
          break;
        }
      }

      if (newsletterIndex !== -1) {
        let workCount = 0;
        for (let j = newsletterIndex + 1; j < TOTAL_DAYS; j++) {
          if (!dates[j].isOff) {
            workCount++;
            if (
              workCount === 2 &&
              !usedActionsPerDay[j]?.has("Confirmation Newsletters")
            ) {
              plan[j] = "Confirmation Newsletters";
              if (!usedActionsPerDay[j]) usedActionsPerDay[j] = new Set();
              usedActionsPerDay[j].add("Confirmation Newsletters");
              break;
            }
          }
        }
      }

      // ---------------------------
      // REMAINING ACTIONS
      // ---------------------------
      const oneTime = actions
        .filter(
          (a) =>
            a.type === "one-time" && !["Connect", "Language"].includes(a.name)
        )
        .map((a) => a.name);

      const repeatable = actions
        .filter(
          (a) =>
            a.type === "repeatable" &&
            !a.dependsOn &&
            a.name !== "NewsLetters With Tracking" &&
            a.name !== "Confirmation Newsletters"
        )
        .map((a) => a.name);

      const usedOneTime = new Set();
      const pool = shuffle([...oneTime, ...repeatable, ...repeatable]);
      let poolIndex = 0;

      for (let i = 0; i < TOTAL_DAYS; i++) {
        if (dates[i].isOff || plan[i]) continue;

        let candidate;
        let safety = 0;

        do {
          candidate = pool[poolIndex % pool.length];
          poolIndex++;
          safety++;

          if (oneTime.includes(candidate) && usedOneTime.has(candidate)) {
            candidate = null;
          }
        } while (
          safety < 50 &&
          (!candidate ||
            plan[i - 1] === candidate ||
            invalidPair(plan[i - 1], candidate) ||
            usedActionsPerDay[i]?.has(candidate)) // 🔴 prevent same action same day
        );

        if (!candidate) continue;

        plan[i] = candidate;

        if (!usedActionsPerDay[i]) usedActionsPerDay[i] = new Set();
        usedActionsPerDay[i].add(candidate);

        if (oneTime.includes(candidate)) {
          usedOneTime.add(candidate);
        }
      }

      // ---------------------------
      // BUILD OUTPUT
      // ---------------------------
      plan.forEach((action, i) => {
        rows.push({
          day: i + 1,
          date: dates[i].date.toISOString().split("T")[0],
          session,
          action: dates[i].isOff ? "OFF" : action,
          type: dates[i].isOff ? "-" : actionMap[action]?.type || "repeatable",
          color: dates[i].isOff
            ? "#e0367d"
            : actionMap[action]?.color || "#999",
        });
      });
    });

    setPlan(rows);
  };
  const exportPlanXLSX = (data, filename) => {
    const rows = data.map((r) => ({
      Day: r.day,
      Date: r.date,
      Session: r.session,
      Action: r.action,
      Type: r.type,
    }));

    exportToXLSX(rows, filename);
  };
  const [customOffDays, setCustomOffDays] = useState([]);
  const DAYS = [
    { label: "Sunday", value: 0 },
    { label: "Monday", value: 1 },
    { label: "Tuesday", value: 2 },
    { label: "Wednesday", value: 3 },
    { label: "Thursday", value: 4 },
    { label: "Friday", value: 5 },
    { label: "Saturday", value: 6 },
  ];
  const PlannerInterface = () => (
    <>
      <div className="tab-header">
        <h1>30-Day Quality Planner</h1>
      </div>
      <p className="muted">
        Define your sequence of actions, assign types (one-time or repeatable),
        and set dependencies. The plan distributes one action per session per
        day for up to 30 days.
      </p>
      {/* 🔴 WARNING */}
      <div className="planner-warning" role="alert">
        ⚠️ <strong>Warning:</strong> The planner logic is currently under review
        and may generate incorrect or incomplete plans. Please do <u>not</u>{" "}
        rely on the results for production use for now.
      </div>
      <div className="controls planner-controls">
        <div className="control-col" style={{ flex: 1 }}>
          <label className="label">
            1. Paste sessions list (one session per line):
          </label>
          <textarea
            placeholder="SessionName1..."
            ref={sessionCtrl.ref}
            className="input-area"
            rows={6}
            value={sessionCtrl.value}
            onChange={sessionCtrl.onChange}
          />
          <div style={{ marginTop: 10 }}>
            <label className="label">2. Select Start Date:</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{
                padding: "8px 10px",
                borderRadius: "8px",
                border: "2px solid var(--color-border)",
                fontSize: "0.9rem",
                background: "transparent",
                color: "var(--color-text)",
                width: "180px",
              }}
            />
          </div>
          <div style={{ marginTop: 15 }}>
            <label className="label">3. Custom OFF Days:</label>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "10px",
                marginTop: "8px",
              }}
            >
              {DAYS.map((day) => (
                <label
                  key={day.value}
                  style={{ display: "flex", alignItems: "center", gap: "5px" }}
                >
                  <input
                    type="checkbox"
                    checked={customOffDays.includes(day.value)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setCustomOffDays((prev) => [...prev, day.value]);
                      } else {
                        setCustomOffDays((prev) =>
                          prev.filter((d) => d !== day.value)
                        );
                      }
                    }}
                  />
                  {day.label}
                </label>
              ))}
            </div>

            <p className="muted" style={{ fontSize: "0.85rem", marginTop: 5 }}>
              Select any days you want to mark as OFF.
            </p>
          </div>
        </div>
      </div>

      <div
        className="row"
        style={{
          justifyContent: "flex-start",
          gap: "15px",
          marginBottom: "20px",
        }}
      >
        <button
          className="btn primary"
          onClick={generatePlan}
          disabled={sessions.length === 0}
        >
          Generate Plan
        </button>
        <button
          className={`btn ${editMode ? "primary" : ""}`}
          onClick={() => setEditMode((prev) => !prev)}
        >
          {editMode ? "Done Editing Actions" : "Edit Actions"}
        </button>
        {/* NEW: Clear Button */}
        <button
          className="btn"
          onClick={() => {
            setSessionText("");
            setPlan([]);
            setPlannerError("");
          }}
        >
          Clear
        </button>
      </div>

      {plannerError && <div className="error">{plannerError}</div>}

      {editMode && (
        <div className="edit-actions-container">
          <h3>Edit Actions</h3>
          <div className="edit-actions-table-wrapper">
            <div className="edit-actions-table">
              <div className="edit-actions-header">
                <div>Action</div>
                <div>Type</div>
                <div>Color</div>
                <div>Dependency</div>
                <div>Delay</div>
                <div></div>
              </div>
              {actions.map((action, index) => (
                <div key={action.name + index} className="edit-action-row">
                  <input
                    type="text"
                    value={action.name}
                    onChange={(e) =>
                      updateAction(index, "name", e.target.value)
                    }
                    disabled={action.name === "Connect"}
                  />
                  <select
                    value={action.type}
                    onChange={(e) =>
                      updateAction(index, "type", e.target.value)
                    }
                  >
                    <option value="one-time">one-time</option>
                    <option value="repeatable">repeatable</option>
                  </select>
                  <input
                    type="color"
                    value={action.color}
                    onChange={(e) =>
                      updateAction(index, "color", e.target.value)
                    }
                  />
                  {action.type === "repeatable" && action.name !== "Connect" ? (
                    <select
                      value={action.dependsOn || ""}
                      onChange={(e) =>
                        updateAction(index, "dependsOn", e.target.value)
                      }
                    >
                      <option value="">No dependency</option>
                      {actions
                        .filter(
                          (a) =>
                            a.type === "repeatable" && a.name !== action.name
                        )
                        .map((a) => (
                          <option key={a.name} value={a.name}>
                            After {a.name}
                          </option>
                        ))}
                    </select>
                  ) : (
                    <div className="no-dependency-label">No dependency</div>
                  )}
                  {action.dependsOn ? (
                    <input
                      type="number"
                      min="1"
                      value={action.delay || 1}
                      onChange={(e) =>
                        updateAction(index, "delay", e.target.value)
                      }
                    />
                  ) : (
                    <div className="no-delay-label">-</div>
                  )}
                  <button
                    className="btn small remove-btn"
                    onClick={() => removeAction(index)}
                    disabled={action.name === "Connect"}
                  >
                    ❌
                  </button>
                </div>
              ))}
              <div className="add-action-row">
                <button className="btn primary" onClick={addAction}>
                  + Add Action
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {plan.length > 0 && (
        <div className="plan-results">
          <h3>Generated 30-Day Plan</h3>
          <div className="session-exports">
            {sessions.map((sessionName, index) => {
              const sessionPlan = plan.filter((r) => r.session === sessionName);
              return (
                <div key={index} className="session-card-export">
                  <h4>
                    {sessionName} ({sessionPlan.length} actions)
                  </h4>
                  <button
                    className="btn primary"
                    onClick={() =>
                      exportPlanXLSX(
                        sessionPlan,
                        `${sessionName}_30day_plan.xlsx`
                      )
                    }
                  >
                    Export XLSX
                  </button>
                </div>
              );
            })}
            <div className="session-card-export all-combined">
              <h4>All Sessions Combined ({plan.length} actions)</h4>
              <button
                className="btn"
                onClick={() =>
                  exportPlanXLSX(plan, "all_sessions_combined_plan.xlsx")
                }
              >
                Export Combined XLSX
              </button>
            </div>
          </div>

          <div className="plan-table-container">
            <table>
              <thead>
                <tr>
                  <th>DAY</th>
                  <th>DATE</th>
                  <th>SESSION</th>
                  <th>ACTION</th>
                  <th>TYPE</th>
                </tr>
              </thead>
              <tbody>
                {plan.map((row, index) => (
                  <tr key={index}>
                    <td className="day-col">{row.day}</td>
                    <td>{row.date}</td>
                    <td>{row.session}</td>
                    <td>
                      <span
                        className="action-pill"
                        style={{
                          backgroundColor: row.color,
                          opacity: row.action === "OFF" ? 0.5 : 1,
                        }}
                      >
                        {row.action}
                      </span>
                    </td>
                    <td>{row.type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );

  // ===============================================
  // 3. Partitioner State & Functions - XLSX EXPORTS
  // ===============================================
  const [partitionerRawData, setPartitionerRawData] = useState("");
  const [partitionerParts, setPartitionerParts] = useState([]);
  const [partitionerStats, setPartitionerStats] = useState(null);
  const [partitionerError, setPartitionerError] = useState("");
  const [selectedFileName, setSelectedFileName] = useState("");
  const partitionCtrl = useStableInput(
    partitionerRawData,
    setPartitionerRawData
  );

  const partitionerHeaders = [
    "ID",
    "Tag",
    "IP_Port",
    "Status",
    "BlockType",
    "Date",
  ];

  const parseLines = (text) => {
    return text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  };

  const analyzeTypeblocks = (allLines) => {
    const counts = {};
    allLines.forEach((line) => {
      const lastDot = line.lastIndexOf(".");
      const lastSemicolon = line.lastIndexOf(";");
      let tb;
      if (lastDot > lastSemicolon) {
        tb = line.slice(lastDot + 1);
      } else if (lastSemicolon >= 0) {
        tb = line.slice(lastSemicolon + 1);
      } else {
        tb = "UNKNOWN";
      }
      counts[tb] = (counts[tb] || 0) + 1;
    });
    return counts;
  };

  const handlePartitionerFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) {
      setSelectedFileName("");
      return;
    }
    setSelectedFileName(file.name);

    readFileContent(file, (result) => {
      if (typeof result === "string" && result.includes("Error")) {
        setPartitionerError(result);
        setPartitionerRawData("");
        return;
      }
      setPartitionerRawData(result);
      setPartitionerError("");
    });
  };

  const handlePartition = () => {
    setPartitionerError("");
    setPartitionerParts([]);
    setPartitionerStats(null);

    if (!partitionerRawData.trim()) {
      setPartitionerError("Paste your list or upload a file first.");
      return;
    }

    const lines = parseLines(partitionerRawData);
    const groups = {};
    const ipFirstIndex = {};
    let maxDuplicates = 0;

    lines.forEach((line, idx) => {
      const ipMatch = line.match(ipv4Regex);
      const key = ipMatch ? ipMatch[0] : `NOIP::${line}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(line);
      if (!(key in ipFirstIndex)) ipFirstIndex[key] = idx;
      if (groups[key].length > maxDuplicates)
        maxDuplicates = groups[key].length;
    });

    const numParts = Math.max(1, maxDuplicates);
    const partitioned = Array.from({ length: numParts }, () => []);

    const totalLines = lines.length;
    const uniqueIPs = Object.keys(groups).length;
    let duplicateCount = 0;
    Object.values(groups).forEach((arr) => {
      if (arr.length > 1) duplicateCount += arr.length - 1;
    });

    const sortedKeys = Object.keys(groups).sort(
      (a, b) => ipFirstIndex[a] - ipFirstIndex[b]
    );

    sortedKeys.forEach((key) => {
      const arr = groups[key];
      arr.forEach((line, i) => {
        const partIndex = i % numParts;
        partitioned[partIndex].push(line);
      });
    });

    const typeblockCounts = analyzeTypeblocks(lines);

    setPartitionerParts(partitioned);
    setPartitionerStats({
      totalLines,
      uniqueIPs,
      duplicateCount,
      typeblockCounts,
      numParts,
    });
  };

  // XLSX Export for single part
  const parseLineSmart = (line) => {
    const numericIdMatch = line.match(/^\d+/);
    const tagMatch = line.match(/\[([^\]]+)\]/);
    const ipMatch = line.match(
      /(?:(?:25[0-5]|2[0-4]\d|1?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|1?\d{1,2})(?::\d+)?/
    );
    const dateMatches = line.match(/\d{2}-[a-zA-Z]+/g);

    const status = line
      .replace(numericIdMatch?.[0] || "", "")
      .replace(tagMatch?.[0] || "", "")
      .replace(ipMatch?.[0] || "", "")
      .replace(dateMatches?.join(" ") || "", "")
      .trim();

    return {
      ID: numericIdMatch ? numericIdMatch[0] : "",
      Tag: tagMatch ? tagMatch[1] : "",
      IP_Port: ipMatch ? ipMatch[0] : "",
      Status: status,
      BlockType: status.includes("Captcha")
        ? "Captcha"
        : status.includes("Unusual")
        ? "Unusual Activity"
        : "",
      Date: dateMatches ? dateMatches.join(" ") : "",
    };
  };

  const exportPartAsXLSX = (index) => {
    const list = partitionerParts[index] || [];
    if (!list.length) return;

    const rows = list.map(parseLineSmart);
    exportToXLSX(rows, `part-${index + 1}.xlsx`);
  };

  // XLSX Export for all parts combined
  const exportAllCombinedAsXLSX = () => {
    if (!partitionerParts.length) return;

    const maxRows = Math.max(...partitionerParts.map((p) => p.length));
    const rows = [];

    for (let i = 0; i < maxRows; i++) {
      const row = {};

      partitionerParts.forEach((part, partIndex) => {
        const prefix = `P${partIndex + 1}_`;
        const parsed = part[i] ? parseLineSmart(part[i]) : {};

        Object.entries(parsed).forEach(([k, v]) => {
          row[`${prefix}${k}`] = v || "";
        });

        // separator column (optional)
        row[`__SEP_${partIndex}`] = "";
      });

      rows.push(row);
    }

    exportToXLSX(rows, "all-parts-side-by-side.xlsx");
  };

  // TXT exports remain the same
  const handleExportPart = (index) => {
    const list = partitionerParts[index] || [];
    downloadText(list.join("\n"), `part-${index + 1}.txt`);
  };

  const handleExportAllCombinedAsTxt = () => {
    if (!partitionerParts.length) return;
    const sections = partitionerParts.map(
      (p, i) => `# PART ${i + 1} (${p.length} lines)\n${p.join("\n")}`
    );
    downloadText(sections.join("\n\n"), "all-parts-combined.txt");
  };

  const handleCopyPart = (index) => {
    const list = partitionerParts[index] || [];
    navigator.clipboard?.writeText(list.join("\n"));
  };

  const PartitionerInterface = () => (
    <>
      <div className="tab-header">
        <h1>Proxy Partitioner IP</h1>
      </div>
      <p className="muted">
        Distribute duplicates so each appearance of the same IP goes to a
        different part (round-robin).
        <br />
        Number of parts = max duplicates of any single IP.
      </p>

      <div className="controls-partitioner">
        <div className="control-col">
          <label className="label">
            Paste your list here (one entry per line):
          </label>
          <textarea
            ref={partitionCtrl.ref}
            className="input-area"
            rows={8}
            value={partitionCtrl.value}
            onChange={partitionCtrl.onChange}
            placeholder=""
          />

          {/* Unified action row: Choose File + File Name + Partition + Clear */}
          <div
            className="row file-upload-row"
            style={{
              marginTop: 15,
              alignItems: "center",
              flexWrap: "wrap",
              gap: "10px",
            }}
          >
            <div
              className="file-input-container"
              style={{ display: "flex", alignItems: "center", gap: "10px" }}
            >
              <input
                type="file"
                accept=".txt,.log,.csv,.xlsx,.xls"
                onChange={handlePartitionerFileUpload}
                ref={commonFileInputRef}
                className="hidden-file-input"
              />
              {/*<button
                className="btn file-select-btn"
                onClick={() => commonFileInputRef.current?.click()}
              >
                Choose File
              </button>
              <span className="file-name-display muted">
                {selectedFileName || "No file chosen"}
              </span>*/}
              <button
                className="btn primary"
                onClick={handlePartition}
                disabled={!partitionerRawData.trim()}
              >
                Partition
              </button>

              <button
                className="btn"
                onClick={() => {
                  setPartitionerRawData("");
                  setPartitionerParts([]);
                  setPartitionerStats(null);
                  setSelectedFileName("");
                  setPartitionerError("");
                  if (commonFileInputRef.current) {
                    commonFileInputRef.current.value = null;
                  }
                }}
              >
                Clear
              </button>
            </div>

            {/* <div className="spacer" />*/}
          </div>

          {partitionerError && <div className="error">{partitionerError}</div>}
        </div>

        <div className="control-col stats">
          <h3>Stats</h3>
          {partitionerStats ? (
            <div>
              <p>
                Total lines: <strong>{partitionerStats.totalLines}</strong>
              </p>
              <p>
                Unique IP/groups: <strong>{partitionerStats.uniqueIPs}</strong>
              </p>
              <p>
                Duplicate occurrences:{" "}
                <strong>{partitionerStats.duplicateCount}</strong>
              </p>
              <p className="final-parts-count">
                Calculated Parts: <strong>{partitionerStats.numParts}</strong>
              </p>
              <div className="global-export-row">
                <button className="btn" onClick={handleExportAllCombinedAsTxt}>
                  Export All (TXT)
                </button>
                <button
                  className="btn primary small"
                  onClick={exportAllCombinedAsXLSX}
                >
                  Export All (XLSX)
                </button>
              </div>
            </div>
          ) : (
            <p className="muted">
              No stats yet — paste a list or upload a file and click Partition.
            </p>
          )}
        </div>
      </div>

      {partitionerParts.length > 0 && (
        <div className="parts-grid">
          {partitionerParts.map((p, idx) => (
            <div key={idx} className="part-card">
              <div className="part-header">
                <strong>Part {idx + 1}</strong>
                <span className="part-count">({p.length} lines)</span>
              </div>
              <textarea
                className="part-area"
                readOnly
                rows={8}
                value={p.join("\n")}
              />
              <div className="part-actions">
                <button
                  className="btn small"
                  onClick={() => handleCopyPart(idx)}
                >
                  Copy
                </button>
                <button
                  className="btn small"
                  onClick={() => handleExportPart(idx)}
                >
                  Export TXT
                </button>
                <button
                  className="btn small primary"
                  onClick={() => exportPartAsXLSX(idx)}
                >
                  Export XLSX
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
  // ===============================================
  // Main Render
  // ===============================================
  return (
    <div className="app-container">
      <div className="header-bar">
        <div className="tab-buttons-container">
          <button
            className={`tab-btn ${selectedTab === "analyzer" ? "active" : ""}`}
            onClick={() => setSelectedTab("analyzer")}
          >
            Analyzer
          </button>
          <button
            className={`tab-btn ${selectedTab === "planner" ? "active" : ""}`}
            onClick={() => setSelectedTab("planner")}
          >
            30-Day Quality Planner
          </button>
          <button
            className={`tab-btn ${
              selectedTab === "partitioner" ? "active" : ""
            }`}
            onClick={() => setSelectedTab("partitioner")}
          >
            Proxy Partitioner
          </button>
        </div>

        <button className="theme-toggle btn" onClick={toggleTheme}>
          {theme === "light" ? "🌙 Dark Mode" : "☀️ Light Mode"}
        </button>
      </div>

      {selectedTab === "analyzer" && <LogAnalyzerInterface />}
      {selectedTab === "planner" && <PlannerInterface />}
      {selectedTab === "partitioner" && <PartitionerInterface />}
    </div>
  );
}
