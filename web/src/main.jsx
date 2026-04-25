import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const fallbackNoteTypes = [
  { id: "basic", name: "Basic", fields: ["Front", "Back"] },
  { id: "cloze", name: "Cloze", fields: ["Text", "Back Extra"] },
];

function makeSampleCards(noteType) {
  const card = Object.fromEntries(
    noteType.fields.map((field) => [field, `${field} field`]),
  );
  return JSON.stringify([card, card], null, 2);
}

function escapeDelimitedCell(value, delimiter = ",") {
  const text = String(value ?? "");
  if (text.includes('"') || text.includes("\n") || text.includes("\r") || text.includes(delimiter)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function makeSampleCsv(noteType) {
  const header = noteType.fields.map((field) => escapeDelimitedCell(field)).join(",");
  const rows = [1, 2].map(() =>
    noteType.fields.map((field) => escapeDelimitedCell(`${field} field`)).join(","),
  );
  return [header, ...rows].join("\n");
}

function parseJson(value) {
  try {
    return { data: JSON.parse(value), error: null };
  } catch (error) {
    return { data: null, error: error.message };
  }
}

function getJsonErrorLocation(value) {
  try {
    JSON.parse(value);
    return null;
  } catch (error) {
    return findJsonSyntaxError(value, error.message || "Invalid JSON");
  }
}

function findJsonSyntaxError(source, browserMessage) {
  let index = 0;
  let line = 1;
  let column = 1;

  function current() {
    return source[index];
  }

  function advance() {
    const char = source[index++];
    if (char === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
    return char;
  }

  function fail(message = browserMessage) {
    throw { line, column, message };
  }

  function skipWhitespace() {
    while (index < source.length && /\s/.test(current())) {
      advance();
    }
  }

  function parseString() {
    if (current() !== '"') fail("Expected a double-quoted string.");
    advance();

    while (index < source.length) {
      const char = advance();

      if (char === '"') return;
      if (char === "\n" || char === "\r") fail("String is missing a closing quote.");

      if (char === "\\") {
        const escaped = advance();
        if (!escaped) fail("String escape is incomplete.");

        if (escaped === "u") {
          for (let count = 0; count < 4; count += 1) {
            const hex = advance();
            if (!/[0-9a-f]/i.test(hex || "")) fail("Invalid unicode escape.");
          }
        } else if (!/["\\/bfnrt]/.test(escaped)) {
          fail("Invalid string escape.");
        }
      }
    }

    fail("String is missing a closing quote.");
  }

  function parseNumber() {
    if (current() === "-") advance();

    if (current() === "0") {
      advance();
    } else if (/[1-9]/.test(current() || "")) {
      while (/[0-9]/.test(current() || "")) advance();
    } else {
      fail("Invalid number.");
    }

    if (current() === ".") {
      advance();
      if (!/[0-9]/.test(current() || "")) fail("Invalid decimal number.");
      while (/[0-9]/.test(current() || "")) advance();
    }

    if (current() === "e" || current() === "E") {
      advance();
      if (current() === "+" || current() === "-") advance();
      if (!/[0-9]/.test(current() || "")) fail("Invalid exponent.");
      while (/[0-9]/.test(current() || "")) advance();
    }
  }

  function parseLiteral(literal) {
    for (const char of literal) {
      if (current() !== char) fail(`Expected ${literal}.`);
      advance();
    }
  }

  function parseArray() {
    advance();
    skipWhitespace();

    if (current() === "]") {
      advance();
      return;
    }

    while (index < source.length) {
      parseValue();
      skipWhitespace();

      if (current() === ",") {
        advance();
        skipWhitespace();
        if (current() === "]") fail("Trailing commas are not valid JSON.");
        continue;
      }

      if (current() === "]") {
        advance();
        return;
      }

      fail("Expected ',' or ']' after array item.");
    }

    fail("Array is missing a closing bracket.");
  }

  function parseObject() {
    advance();
    skipWhitespace();

    if (current() === "}") {
      advance();
      return;
    }

    while (index < source.length) {
      if (current() !== '"') fail("Object keys must be double-quoted.");
      parseString();
      skipWhitespace();

      if (current() !== ":") fail("Expected ':' after object key.");
      advance();
      skipWhitespace();

      parseValue();
      skipWhitespace();

      if (current() === ",") {
        advance();
        skipWhitespace();
        if (current() === "}") fail("Trailing commas are not valid JSON.");
        continue;
      }

      if (current() === "}") {
        advance();
        return;
      }

      fail("Expected ',' or '}' after object value.");
    }

    fail("Object is missing a closing brace.");
  }

  function parseValue() {
    skipWhitespace();

    const char = current();
    if (char === "{") return parseObject();
    if (char === "[") return parseArray();
    if (char === '"') return parseString();
    if (char === "-" || /[0-9]/.test(char || "")) return parseNumber();
    if (char === "t") return parseLiteral("true");
    if (char === "f") return parseLiteral("false");
    if (char === "n") return parseLiteral("null");

    fail("Expected a JSON value.");
  }

  try {
    parseValue();
    skipWhitespace();
    if (index < source.length) fail("Unexpected content after JSON value.");
  } catch (syntaxError) {
    return {
      line: syntaxError.line || 1,
      column: syntaxError.column || 1,
      message: syntaxError.message || browserMessage,
    };
  }

  return { line: 1, column: 1, message: browserMessage };
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function validateCardsArray(cards, noteType) {
  const allowedFields = new Set(noteType.fields);
  const errors = [];
  const warnings = [];

  if (!Array.isArray(cards)) {
    return { cards: [], errors: ["Card data must be a list."], warnings };
  }

  cards.forEach((card, index) => {
    if (!card || Array.isArray(card) || typeof card !== "object") {
      errors.push(`Card ${index + 1} must be an object.`);
      return;
    }

    const unknown = Object.keys(card).filter((key) => !allowedFields.has(key));
    if (unknown.length) {
      errors.push(`Card ${index + 1} has unknown field(s): ${unknown.join(", ")}.`);
    }

    noteType.fields.forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(card, field) || String(card[field] ?? "").trim() === "") {
        warnings.push(`Card ${index + 1} is missing "${field}".`);
      }
    });

    Object.entries(card).forEach(([key, fieldValue]) => {
      if (allowedFields.has(key) && typeof fieldValue !== "string") {
        errors.push(`Card ${index + 1} field "${key}" must be text.`);
      }
    });
  });

  return { cards: errors.length ? [] : cards, errors, warnings };
}

function validateCards(value, noteType) {
  const parsed = parseJson(value);
  if (parsed.error) {
    return { cards: [], errors: [`Invalid JSON: ${parsed.error}`], warnings: [] };
  }

  if (!Array.isArray(parsed.data)) {
    return { cards: [], errors: ["The JSON must be a list of card objects."], warnings: [] };
  }

  return validateCardsArray(parsed.data, noteType);
}

function countDelimiter(line, delimiter) {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && char === delimiter) {
      count += 1;
    }
  }
  return count;
}

function detectDelimiter(value) {
  const sampleLines = value.split(/\r?\n/).filter((line) => line.trim()).slice(0, 5);
  const tabCount = sampleLines.reduce((total, line) => total + countDelimiter(line, "\t"), 0);
  const commaCount = sampleLines.reduce((total, line) => total + countDelimiter(line, ","), 0);
  return tabCount > commaCount ? "\t" : ",";
}

function parseDelimitedText(value, delimiterMode) {
  const delimiter = delimiterMode === "auto" ? detectDelimiter(value) : delimiterMode;
  const rows = [];
  const errors = [];
  let row = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let column = 1;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (quoted) {
      if (char === '"') {
        if (value[index + 1] === '"') {
          cell += '"';
          index += 1;
          column += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"') {
      if (cell.length === 0) {
        quoted = true;
      } else {
        errors.push(`Line ${line}, column ${column}: quote must start the cell.`);
      }
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      line += 1;
      column = 0;
    } else if (char !== "\r") {
      cell += char;
    }

    column += 1;
  }

  if (quoted) {
    errors.push(`Line ${line}, column ${column}: quoted cell is missing a closing quote.`);
  }

  row.push(cell);
  if (row.some((cellValue) => cellValue.trim()) || rows.length > 0) {
    rows.push(row);
  }

  return { rows, errors, delimiter };
}

function getCsvColumns(parsedCsv, csvHasHeader) {
  if (!parsedCsv.rows.length) return [];

  const firstRow = parsedCsv.rows[0];
  return firstRow.map((cell, index) => {
    const header = csvHasHeader ? cell.trim() : "";
    return header || `Column ${index + 1}`;
  });
}

function getCsvDataRows(parsedCsv, csvHasHeader) {
  return csvHasHeader ? parsedCsv.rows.slice(1) : parsedCsv.rows;
}

function createAutoMapping(noteType, columns) {
  return Object.fromEntries(
    noteType.fields.map((field, index) => {
      const exactIndex = columns.findIndex((column) => normalizeName(column) === normalizeName(field));
      return [field, String(exactIndex >= 0 ? exactIndex : index < columns.length ? index : "")];
    }),
  );
}

function buildCardsFromCsv(rows, mapping, noteType) {
  const warnings = [];
  const cards = rows
    .filter((row) => row.some((cell) => String(cell).trim()))
    .map((row, rowIndex) => {
      const card = {};
      noteType.fields.forEach((field) => {
        const columnIndex = mapping[field] === "" ? -1 : Number(mapping[field]);
        if (Number.isInteger(columnIndex) && columnIndex >= 0) {
          card[field] = row[columnIndex] ?? "";
        } else {
          card[field] = "";
          warnings.push(`CSV row ${rowIndex + 1} has no column mapped to "${field}".`);
        }
      });
      return card;
    });

  return { cards, warnings };
}

function parseTagsInput(value) {
  return value
    .replaceAll(",", " ")
    .split(/\s+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function tagsToInput(tags) {
  return tags.join(" ");
}

function addTagToInput(value, tag) {
  const tags = parseTagsInput(value);
  if (!tags.includes(tag)) {
    tags.push(tag);
  }
  return tagsToInput(tags);
}

function removeTagFromInput(value, tag) {
  return tagsToInput(parseTagsInput(value).filter((currentTag) => currentTag !== tag));
}

function formatTagList(tags) {
  return tags.length ? tags.join(", ") : "No tags";
}

function describeCreationReport(report) {
  if (!report) return "";
  const base = `${report.createdCount ?? 0} created`;
  if (!report.failedCount) return base;
  return `${base}, ${report.failedCount} failed`;
}

function limitMessages(messages, max = 10) {
  if (messages.length <= max) return messages;
  return [...messages.slice(0, max), `${messages.length - max} more...`];
}

function summarizeWarnings(warnings) {
  if (!warnings.length) return "No warnings";
  return `${warnings.length} warning${warnings.length === 1 ? "" : "s"}`;
}

function summarizeErrors(errors) {
  if (!errors.length) return "No blocking errors";
  return `${errors.length} error${errors.length === 1 ? "" : "s"}`;
}

function isPartialSuccess(report) {
  return Boolean(report?.partialSuccess || (report?.createdCount > 0 && report?.failedCount > 0));
}

function isFullSuccess(report) {
  return Boolean(report?.success && !report?.failedCount);
}

function buildValidationSummary({ deckName, noteType, tags, cards, warnings, errors, inputMode }) {
  return {
    deckName: deckName.trim() || "Bulk Card Creator",
    noteTypeName: noteType.name,
    tags,
    cardCount: cards.length,
    warningCount: warnings.length,
    errorCount: errors.length,
    inputMode: inputMode === "csv" ? "CSV/TSV" : "JSON",
  };
}

function noop() {}

function stopEvent(event) {
  event.stopPropagation();
}

function preventSubmit(event) {
  event.preventDefault();
}

function identity(value) {
  return value;
}

function hasCards(cards) {
  return Array.isArray(cards) && cards.length > 0;
}

function getSelectedTagCount(tagsInput) {
  return parseTagsInput(tagsInput).length;
}

function getErrorStatus(errors, warnings) {
  if (errors.length) return "error";
  if (warnings.length) return "warning";
  return "success";
}

function getReadyMessage(cards, warnings) {
  const suffix = warnings.length ? ` with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : "";
  return `${cards.length} card${cards.length === 1 ? "" : "s"} ready${suffix}.`;
}

function getCsvRowLabel(csvHasHeader) {
  return csvHasHeader ? "data row" : "row";
}

function removeDuplicateMessages(messages) {
  return [...new Set(messages)];
}

function normalizeValidationResult(result) {
  return {
    cards: result.cards || [],
    errors: removeDuplicateMessages(result.errors || []),
    warnings: removeDuplicateMessages(result.warnings || []),
  };
}

function getFirstField(noteType) {
  return noteType.fields[0] || "Front";
}

function isMissingPrimaryFields(cards, noteType) {
  const firstField = getFirstField(noteType);
  return cards.some((card) => !String(card[firstField] ?? "").trim());
}

function getInputModeLabel(inputMode) {
  return inputMode === "csv" ? "CSV/TSV" : "JSON";
}

function getDelimiterLabel(delimiter) {
  if (delimiter === "\t") return "Tab";
  if (delimiter === ",") return "Comma";
  return "Auto";
}

function createCsvPreview(cards) {
  return JSON.stringify(cards.slice(0, 3), null, 2);
}

function cardCountText(count) {
  return `${count} card${count === 1 ? "" : "s"}`;
}

function warningCountText(count) {
  return `${count} warning${count === 1 ? "" : "s"}`;
}

function errorCountText(count) {
  return `${count} error${count === 1 ? "" : "s"}`;
}

function resultTone(report) {
  if (!report) return "";
  if (isFullSuccess(report)) return "success";
  if (isPartialSuccess(report)) return "warning";
  return "error";
}

function getCsvMappingWarnings(mapping, noteType) {
  const errors = [];
  const warnings = [];

  noteType.fields.forEach((field) => {
    if (mapping[field] === "") {
      warnings.push(`No CSV column is mapped to "${field}".`);
    }
  });

  return { errors, warnings };
}

function createBridge() {
  if (typeof window !== "undefined" && !window.pyProcCallback) {
    window.pyProcCallback = {};
  }

  function send(command, data = null) {
    return new Promise((resolve, reject) => {
      const callbackName = `callback_${Date.now()}_${Math.random()
        .toString(16)
        .slice(2)}`;

      window.pyProcCallback[callbackName] = (result) => {
        delete window.pyProcCallback[callbackName];
        resolve(result);
      };

      const payload = data === null ? "null" : data;
      const message = `GCFJ:${command}:${callbackName}:${payload}`;

      if (typeof window.pycmd === "function") {
        window.pycmd(message);
        return;
      }

      delete window.pyProcCallback[callbackName];
      reject(new Error("Anki bridge is not available in this browser."));
    });
  }

  return {
    send,
    async getNoteTypes() {
      const result = await send("get_note");
      const parsed = typeof result === "string" ? JSON.parse(result) : result;
      if (Array.isArray(parsed)) return parsed;
      throw new Error(parsed?.error || "Could not load note types.");
    },
    async getTags() {
      if (typeof window.pycmd !== "function") {
        return ["biology", "chapter_1", "exam", "review"];
      }

      const result = await send("get_tags");
      const parsed = typeof result === "string" ? JSON.parse(result) : result;
      return Array.isArray(parsed) ? parsed : [];
    },
    createCards(payload) {
      return send("create_cards", JSON.stringify(payload));
    },
    async getPreferences() {
      if (typeof window.pycmd !== "function") {
        return JSON.parse(localStorage.getItem("ankiCardCreatorPreferences") || "{}");
      }

      const result = await send("get_preferences");
      return typeof result === "string" ? JSON.parse(result) : result;
    },
    async savePreferences(preferences) {
      if (typeof window.pycmd !== "function") {
        const current = JSON.parse(
          localStorage.getItem("ankiCardCreatorPreferences") || "{}",
        );
        const next = { ...current, ...preferences };
        localStorage.setItem("ankiCardCreatorPreferences", JSON.stringify(next));
        return next;
      }

      const result = await send("save_preferences", JSON.stringify(preferences));
      return typeof result === "string" ? JSON.parse(result) : result;
    },
    copyToClipboard(text) {
      return send("copy_to_clipboard", text);
    },
  };
}

const bridge = createBridge();

function App() {
  const [noteTypes, setNoteTypes] = useState(fallbackNoteTypes);
  const [availableTags, setAvailableTags] = useState([]);
  const [selectedNoteType, setSelectedNoteType] = useState(fallbackNoteTypes[0]);
  const [deckName, setDeckName] = useState("Bulk Card Creator");
  const [tagsInput, setTagsInput] = useState("");
  const [tagQuery, setTagQuery] = useState("");
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [inputMode, setInputMode] = useState("json");
  const [jsonValue, setJsonValue] = useState(makeSampleCards(fallbackNoteTypes[0]));
  const [csvValue, setCsvValue] = useState(makeSampleCsv(fallbackNoteTypes[0]));
  const [csvDelimiter, setCsvDelimiter] = useState("auto");
  const [csvHasHeader, setCsvHasHeader] = useState(true);
  const [csvMapping, setCsvMapping] = useState({});
  const [validatedCards, setValidatedCards] = useState([]);
  const [errors, setErrors] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [validationSummary, setValidationSummary] = useState(null);
  const [creationReport, setCreationReport] = useState(null);
  const [status, setStatus] = useState({ type: "idle", message: "" });
  const [isNoteTypePickerOpen, setIsNoteTypePickerOpen] = useState(false);
  const [isBridgeReady, setIsBridgeReady] = useState(false);

  const previewJson = useMemo(() => {
    const parsed = parseJson(jsonValue);
    return parsed.error ? jsonValue : JSON.stringify(parsed.data, null, 2);
  }, [jsonValue]);

  const sampleJson = useMemo(
    () => makeSampleCards(selectedNoteType),
    [selectedNoteType],
  );

  const jsonErrorLocation = useMemo(
    () => getJsonErrorLocation(jsonValue),
    [jsonValue],
  );

  const parsedCsv = useMemo(
    () => parseDelimitedText(csvValue, csvDelimiter),
    [csvValue, csvDelimiter],
  );

  const csvColumns = useMemo(
    () => getCsvColumns(parsedCsv, csvHasHeader),
    [parsedCsv, csvHasHeader],
  );

  const csvDataRows = useMemo(
    () => getCsvDataRows(parsedCsv, csvHasHeader),
    [parsedCsv, csvHasHeader],
  );

  const csvCardsPreview = useMemo(
    () => buildCardsFromCsv(csvDataRows, csvMapping, selectedNoteType),
    [csvDataRows, csvMapping, selectedNoteType],
  );

  const parsedTags = useMemo(() => parseTagsInput(tagsInput), [tagsInput]);

  const filteredTags = useMemo(
    () =>
      availableTags
        .filter((tag) => !parsedTags.includes(tag))
        .filter((tag) => tag.toLowerCase().includes(tagQuery.toLowerCase()))
        .slice(0, 40),
    [availableTags, parsedTags, tagQuery],
  );

  useEffect(() => {
    setCsvMapping(createAutoMapping(selectedNoteType, csvColumns));
  }, [selectedNoteType, csvColumns.join("\u0001")]);

  useEffect(() => {
    const markReady = () => setIsBridgeReady(true);

    if (window.bridgeReady || typeof window.pycmd === "function") {
      markReady();
    } else {
      window.onBridgeReady = markReady;
    }
  }, []);

  useEffect(() => {
    if (!isBridgeReady && typeof window.pycmd === "function") return;

    async function loadInitialState() {
      try {
        const [types, preferences, tags] = await Promise.all([
          typeof window.pycmd === "function"
            ? bridge.getNoteTypes()
            : Promise.resolve(fallbackNoteTypes),
          bridge.getPreferences(),
          bridge.getTags(),
        ]);

        if (!types.length) return;

        const savedNoteType = preferences?.lastNoteType;
        const savedNoteTypeId = savedNoteType?.id != null ? String(savedNoteType.id) : null;
        const savedNoteTypeName = savedNoteType?.name;
        const nextNoteType =
          types.find(
            (type) =>
              (savedNoteTypeId && String(type.id) === savedNoteTypeId) ||
              (savedNoteTypeName && type.name === savedNoteTypeName),
          ) || types[0];

        setNoteTypes(types);
        setAvailableTags(tags);
        setSelectedNoteType(nextNoteType);
        setJsonValue(makeSampleCards(nextNoteType));
        setCsvValue(makeSampleCsv(nextNoteType));

        if (typeof preferences?.lastDeckName === "string" && preferences.lastDeckName.trim()) {
          setDeckName(preferences.lastDeckName);
        }
      } catch {
        setStatus({
          type: "warning",
          message: "Using sample note types until the addon runs inside Anki.",
        });
      }
    }

    loadInitialState();
  }, [isBridgeReady]);

  function saveCurrentPreferences(nextNoteType = selectedNoteType, nextDeckName = deckName) {
    bridge.savePreferences({
      lastNoteType: {
        id: nextNoteType.id,
        name: nextNoteType.name,
      },
      lastDeckName: nextDeckName.trim(),
    }).catch(() => {});
  }

  function updateTagsInput(value) {
    setTagsInput(value);
    setValidationSummary((summary) =>
      summary ? { ...summary, tags: parseTagsInput(value) } : summary,
    );
  }

  function addExistingTag(tag) {
    updateTagsInput(addTagToInput(tagsInput, tag));
    setTagQuery("");
  }

  function removeSelectedTag(tag) {
    updateTagsInput(removeTagFromInput(tagsInput, tag));
  }

  function chooseNoteType(noteType) {
    setSelectedNoteType(noteType);
    setJsonValue(makeSampleCards(noteType));
    setCsvValue(makeSampleCsv(noteType));
    setValidatedCards([]);
    setErrors([]);
    setWarnings([]);
    setValidationSummary(null);
    setCreationReport(null);
    setIsNoteTypePickerOpen(false);
    setStatus({ type: "idle", message: "" });
    saveCurrentPreferences(noteType);
  }

  function resetValidationState() {
    setErrors([]);
    setWarnings([]);
    setValidatedCards([]);
    setValidationSummary(null);
    setCreationReport(null);
    setStatus({ type: "idle", message: "" });
  }

  function validateInput() {
    let result;

    if (inputMode === "csv") {
      if (parsedCsv.errors.length) {
        result = { cards: [], errors: parsedCsv.errors, warnings: [] };
      } else if (!csvDataRows.length) {
        result = { cards: [], errors: ["Paste at least one CSV/TSV data row."], warnings: [] };
      } else {
        const mapped = buildCardsFromCsv(csvDataRows, csvMapping, selectedNoteType);
        const mappingResult = getCsvMappingWarnings(csvMapping, selectedNoteType);
        const validation = validateCardsArray(mapped.cards, selectedNoteType);
        result = normalizeValidationResult({
          cards: validation.cards,
          errors: [...mappingResult.errors, ...validation.errors],
          warnings: [...mapped.warnings, ...mappingResult.warnings, ...validation.warnings],
        });
      }
    } else {
      result = normalizeValidationResult(validateCards(jsonValue, selectedNoteType));
    }

    setErrors(result.errors);
    setWarnings(result.warnings);
    setValidatedCards(result.cards);
    setValidationSummary(
      buildValidationSummary({
        deckName,
        noteType: selectedNoteType,
        tags: parsedTags,
        cards: result.cards,
        warnings: result.warnings,
        errors: result.errors,
        inputMode,
      }),
    );
    setCreationReport(null);
    setStatus(
      result.errors.length
        ? { type: "error", message: `Fix the ${getInputModeLabel(inputMode)} before creating cards.` }
        : { type: getErrorStatus(result.errors, result.warnings), message: getReadyMessage(result.cards, result.warnings) },
    );
  }

  function updateCard(cardIndex, field, fieldValue) {
    setValidatedCards((cards) => {
      const next = cards.map((card, index) =>
        index === cardIndex ? { ...card, [field]: fieldValue } : card,
      );
      setJsonValue(JSON.stringify(next, null, 2));
      setValidationSummary((summary) => summary ? { ...summary, cardCount: next.length } : summary);
      return next;
    });
  }

  function deleteCard(cardIndex) {
    setValidatedCards((cards) => {
      const next = cards.filter((_, index) => index !== cardIndex);
      setJsonValue(JSON.stringify(next, null, 2));
      setValidationSummary((summary) => summary ? { ...summary, cardCount: next.length } : summary);
      return next;
    });
  }

  async function copySample() {
    const sample = inputMode === "csv" ? makeSampleCsv(selectedNoteType) : sampleJson;
    try {
      if (typeof window.pycmd === "function") {
        await bridge.copyToClipboard(sample);
      } else {
        await navigator.clipboard.writeText(sample);
      }
      setStatus({ type: "success", message: `${getInputModeLabel(inputMode)} format copied.` });
    } catch (error) {
      setStatus({ type: "error", message: error.message });
    }
  }

  async function createCards() {
    const cleanedDeckName = deckName.trim();
    if (!cleanedDeckName) {
      setStatus({ type: "error", message: "Enter a deck name before creating cards." });
      return;
    }

    if (!validatedCards.length) {
      validateInput();
      return;
    }

    setStatus({ type: "busy", message: "Creating cards..." });
    try {
      saveCurrentPreferences(selectedNoteType, cleanedDeckName);
      const result = await bridge.createCards({
        noteType: selectedNoteType,
        deckName: cleanedDeckName,
        tags: parsedTags,
        cards: validatedCards,
      });
      const parsed = typeof result === "string" ? JSON.parse(result) : result;

      setCreationReport(parsed);

      if (!parsed.success && !parsed.partialSuccess) {
        throw new Error(parsed.errors?.join(", ") || "Anki could not create the cards.");
      }

      setValidatedCards([]);
      setJsonValue(sampleJson);
      setCsvValue(makeSampleCsv(selectedNoteType));
      setStatus({
        type: isPartialSuccess(parsed) ? "warning" : "success",
        message: parsed.message || describeCreationReport(parsed),
      });
    } catch (error) {
      setStatus({ type: "error", message: error.message });
    }
  }

  return (
    <main className="app-shell">
      <header className="toolbar">
        <div>
          <p className="eyebrow">Bulk Card Creator</p>
          <h1>Paste JSON, validate, create Anki cards.</h1>
        </div>
        <div className="target-controls">
          <label className="deck-field">
            <span>Deck</span>
            <input
              value={deckName}
              onChange={(event) => setDeckName(event.target.value)}
              onBlur={(event) => saveCurrentPreferences(selectedNoteType, event.target.value)}
              placeholder="Parent/Parent/Child"
            />
          </label>
          <label className="deck-field tags-field">
            <span>Tags</span>
            <input
              value={tagsInput}
              onChange={(event) => {
                setTagsInput(event.target.value);
                setValidationSummary((summary) =>
                  summary ? { ...summary, tags: parseTagsInput(event.target.value) } : summary,
                );
              }}
              placeholder="biology chapter_1"
            />
          </label>
          <button
            className="note-type-button"
            type="button"
            onClick={() => setIsNoteTypePickerOpen(true)}
          >
            <span>Note Type</span>
            <strong>{selectedNoteType.name}</strong>
          </button>
        </div>
      </header>

      <section className="editor-panel">
        <div className="panel-heading">
          <div>
            <h2>{getInputModeLabel(inputMode)} Input</h2>
            <p>{selectedNoteType.fields.length} fields expected</p>
          </div>
          <div className="panel-actions">
            <div className="segmented-control" aria-label="Input mode">
              <button
                type="button"
                className={inputMode === "json" ? "active" : ""}
                onClick={() => {
                  setInputMode("json");
                  resetValidationState();
                }}
              >
                JSON
              </button>
              <button
                type="button"
                className={inputMode === "csv" ? "active" : ""}
                onClick={() => {
                  setInputMode("csv");
                  resetValidationState();
                }}
              >
                CSV/TSV
              </button>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                if (inputMode === "csv") {
                  setCsvValue(makeSampleCsv(selectedNoteType));
                } else {
                  setJsonValue(sampleJson);
                }
                resetValidationState();
              }}
            >
              Reset Sample
            </button>
          </div>
        </div>

        {inputMode === "json" ? (
          <div className="editor-grid">
            <JsonEditor
              value={jsonValue}
              errorLocation={jsonErrorLocation}
              onChange={(value) => {
                setJsonValue(value);
                resetValidationState();
              }}
            />

            <div className="code-box preview-box" aria-label="JSON preview">
              <span>Preview</span>
              <pre>{previewJson}</pre>
            </div>
          </div>
        ) : (
          <div className="editor-grid">
            <label className="code-box csv-editor">
              <span>CSV / TSV Paste</span>
              <textarea
                value={csvValue}
                spellCheck="false"
                onChange={(event) => {
                  setCsvValue(event.target.value);
                  resetValidationState();
                }}
              />
            </label>

            <CsvMappingPanel
              delimiter={csvDelimiter}
              detectedDelimiter={parsedCsv.delimiter}
              hasHeader={csvHasHeader}
              columns={csvColumns}
              dataRows={csvDataRows}
              mapping={csvMapping}
              noteType={selectedNoteType}
              previewCards={csvCardsPreview.cards}
              onDelimiterChange={(value) => {
                setCsvDelimiter(value);
                resetValidationState();
              }}
              onHeaderChange={(value) => {
                setCsvHasHeader(value);
                resetValidationState();
              }}
              onMappingChange={(field, columnIndex) => {
                setCsvMapping((mapping) => ({ ...mapping, [field]: columnIndex }));
                resetValidationState();
              }}
            />
          </div>
        )}

        <div className="action-row">
          <button className="primary-button" type="button" onClick={validateInput}>
            Validate {getInputModeLabel(inputMode)}
          </button>
          <button className="ghost-button" type="button" onClick={copySample}>
            Copy Format
          </button>
          {status.message && <p className={`status ${status.type}`}>{status.message}</p>}
        </div>

        {errors.length > 0 && (
          <div className="error-list">
            {errors.map((error) => (
              <p key={error}>{error}</p>
            ))}
          </div>
        )}

        {warnings.length > 0 && (
          <div className="warning-list">
            {limitMessages(warnings).map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        )}
      </section>

      {validationSummary && (
        <SummaryPanel
          summary={validationSummary}
          errors={errors}
          warnings={warnings}
          primaryFieldMissing={isMissingPrimaryFields(validatedCards, selectedNoteType)}
        />
      )}

      {creationReport && <CreationReportPanel report={creationReport} />}

      {validatedCards.length > 0 && (
        <section className="cards-panel">
          <div className="panel-heading">
            <div>
              <h2>Validated Cards</h2>
              <p>Edit fields before sending them to Anki.</p>
            </div>
            <button className="create-button" type="button" onClick={createCards}>
              Create {validatedCards.length} Cards
            </button>
          </div>

          <div className="card-list">
            {validatedCards.map((card, cardIndex) => (
              <article className="card-editor" key={`card-${cardIndex}`}>
                <div className="card-header">
                  <strong>Card {cardIndex + 1}</strong>
                  <button type="button" onClick={() => deleteCard(cardIndex)}>
                    Delete
                  </button>
                </div>

                {selectedNoteType.fields.map((field) => (
                  <label className="field-row" key={field}>
                    <span>{field}</span>
                    <input
                      value={card[field] || ""}
                      onChange={(event) => updateCard(cardIndex, field, event.target.value)}
                    />
                  </label>
                ))}
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="format-panel">
        <div className="panel-heading">
          <div>
            <h2>Valid JSON Format</h2>
            <p>Use these exact field names for the selected note type.</p>
          </div>
          <button className="secondary-button" type="button" onClick={copySample}>
            Copy
          </button>
        </div>
        <pre>{sampleJson}</pre>
      </section>

      {isNoteTypePickerOpen && (
        <NoteTypePicker
          noteTypes={noteTypes}
          selectedNoteType={selectedNoteType}
          onClose={() => setIsNoteTypePickerOpen(false)}
          onSelect={chooseNoteType}
        />
      )}
    </main>
  );
}

function JsonEditor({ value, errorLocation, onChange }) {
  const [scrollTop, setScrollTop] = useState(0);
  const lines = value.split("\n");

  return (
    <label className="code-box json-editor">
      <span>Editable JSON</span>
      <div className="json-editor-body">
        <div className="json-gutter" aria-hidden="true">
          <div style={{ transform: `translateY(-${scrollTop}px)` }}>
            {lines.map((_, index) => {
              const lineNumber = index + 1;
              const hasError = errorLocation?.line === lineNumber;

              return (
                <div className={`gutter-line ${hasError ? "has-error" : ""}`} key={lineNumber}>
                  <span className="error-marker">{hasError ? "x" : ""}</span>
                  <span>{lineNumber}</span>
                </div>
              );
            })}
          </div>
        </div>
        <textarea
          value={value}
          spellCheck="false"
          aria-invalid={Boolean(errorLocation)}
          aria-describedby={errorLocation ? "json-error-location" : undefined}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      {errorLocation && (
        <p className="json-inline-error" id="json-error-location">
          Line {errorLocation.line}
          {errorLocation.column ? `, column ${errorLocation.column}` : ""}:{" "}
          {errorLocation.message}
        </p>
      )}
    </label>
  );
}

function CsvMappingPanel({
  delimiter,
  detectedDelimiter,
  hasHeader,
  columns,
  dataRows,
  mapping,
  noteType,
  previewCards,
  onDelimiterChange,
  onHeaderChange,
  onMappingChange,
}) {
  return (
    <div className="csv-tools-panel">
      <div className="csv-options">
        <label>
          <span>Delimiter</span>
          <select value={delimiter} onChange={(event) => onDelimiterChange(event.target.value)}>
            <option value="auto">Auto ({getDelimiterLabel(detectedDelimiter)})</option>
            <option value=",">Comma</option>
            <option value={"\t"}>Tab</option>
          </select>
        </label>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={hasHeader}
            onChange={(event) => onHeaderChange(event.target.checked)}
          />
          <span>First row contains headers</span>
        </label>
      </div>

      <div className="mapping-section">
        <div className="mapping-heading">
          <h3>Field Mapping</h3>
          <p>
            {dataRows.length} {getCsvRowLabel(hasHeader)}
            {dataRows.length === 1 ? "" : "s"} detected
          </p>
        </div>

        {noteType.fields.map((field) => (
          <label className="mapping-row" key={field}>
            <span>{field}</span>
            <select
              value={mapping[field] ?? ""}
              onChange={(event) => onMappingChange(field, event.target.value)}
            >
              <option value="">No column</option>
              {columns.map((column, index) => (
                <option value={String(index)} key={`${column}-${index}`}>
                  {column}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <div className="csv-preview">
        <span>Mapped Preview</span>
        <pre>{previewCards.length ? createCsvPreview(previewCards) : "[]"}</pre>
      </div>
    </div>
  );
}

function SummaryPanel({ summary, errors, warnings, primaryFieldMissing }) {
  return (
    <section className="summary-panel">
      <div className="summary-grid">
        <div>
          <span>Deck</span>
          <strong>{summary.deckName}</strong>
        </div>
        <div>
          <span>Note Type</span>
          <strong>{summary.noteTypeName}</strong>
        </div>
        <div>
          <span>Input</span>
          <strong>{summary.inputMode}</strong>
        </div>
        <div>
          <span>Cards</span>
          <strong>{cardCountText(summary.cardCount)}</strong>
        </div>
        <div>
          <span>Tags</span>
          <strong>{formatTagList(summary.tags)}</strong>
        </div>
        <div>
          <span>Checks</span>
          <strong>{summarizeErrors(errors)} / {summarizeWarnings(warnings)}</strong>
        </div>
      </div>

      {primaryFieldMissing && (
        <p className="summary-warning">
          Some cards are missing the first field. Anki may reject empty first fields.
        </p>
      )}
    </section>
  );
}

function CreationReportPanel({ report }) {
  return (
    <section className={`creation-report ${resultTone(report)}`}>
      <div>
        <h2>Creation Report</h2>
        <p>{report.message || describeCreationReport(report)}</p>
      </div>
      <div className="report-stats">
        <span>{report.createdCount ?? 0} created</span>
        <span>{report.failedCount ?? 0} failed</span>
        <span>{formatTagList(report.tags || [])}</span>
      </div>
      {report.failedCards?.length > 0 && (
        <div className="report-failures">
          {limitMessages(report.failedCards.map((item) => `Card ${item.index}: ${item.error}`)).map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      )}
    </section>
  );
}

function NoteTypePicker({ noteTypes, selectedNoteType, onClose, onSelect }) {
  const [query, setQuery] = useState("");
  const filteredTypes = noteTypes.filter((noteType) =>
    `${noteType.name} ${noteType.fields.join(" ")}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="note-type-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="note-type-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Anki Collection</p>
            <h2 id="note-type-title">Choose a Note Type</h2>
          </div>
          <button className="close-button" type="button" aria-label="Close" onClick={onClose}>
            x
          </button>
        </div>

        <input
          className="search-input"
          value={query}
          placeholder="Search note types or fields"
          onChange={(event) => setQuery(event.target.value)}
          autoFocus
        />

        <div className="note-type-list">
          {filteredTypes.map((noteType) => {
            const isSelected = noteType.name === selectedNoteType.name;
            return (
              <button
                className={`note-type-option ${isSelected ? "selected" : ""}`}
                type="button"
                key={`${noteType.id}-${noteType.name}`}
                onClick={() => onSelect(noteType)}
              >
                <span className="radio-dot" aria-hidden="true" />
                <span className="note-type-copy">
                  <strong>{noteType.name}</strong>
                  <span>{noteType.fields.join(", ")}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
