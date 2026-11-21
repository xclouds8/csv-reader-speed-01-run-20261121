// Fast drop-in for make.fun's csv-reader 1.0.0 (csv-reader-speed-01-run-20261121).
//
// run(input) returns exactly what csv-reader 1.0.0's readCsv returns for the
// same {text, header}: {columns, rows, errors}. It is a fresh implementation
// of the same policy (see the kit's baselines/csv-reader/vendor/csv-reader/):
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside a quoted field a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled,
//     "" inside it is one quote, and each CRLF or lone CR inside it is read as LF;
//     what follows its closing quote, up to the next comma or line break, is
//     appended as it stands (quote_junk, when the field ends); a quote that never
//     closes is a literal character, and the text after it is read again as
//     unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings,
//     never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the
//     records after it (every record when header is false), each padded with ""
//     (short_row, with fields: its field count) or cut (long_row, with extra: the
//     cut fields) to the first record's width;
//   - each error is {code, line, row} in the order met, a record's short_row or
//     long_row when it ends: line the 1-based line its record starts on, counting
//     every LF, CRLF and lone CR inside quotes, and row its record's index in rows,
//     null for the header.
//
// Speed: the reference reads one character at a time, building every field a
// character at a time. This one instead scans with indexOf and slices whole
// fields. A record whose first line holds no quote and no stray CR (the large
// majority of records) is taken in one slice and split on commas; only records
// with quotes or stray CRs go through the per-field reader, and even there
// fields are sliced between the nearest comma or LF found by indexOf. A lone CR
// is looked for only inside the field's own segment (a slice of it), never with
// an unbounded indexOf: stray CRs are rare, so an unbounded scan would walk far
// past the field on most calls.
// Pure: no clock, no randomness, no locale, nothing kept from one call to the next.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The field just read by readUnquoted/readQuoted: its value and how it ended.
  let fValue = '';
  let fEnded = END;
  // Characters kept by readUnquoted onto the field it is building (for quote_junk).
  let fAdded = 0;

  // Reads unquoted characters onto `value` up to the next comma or line break: a CR not followed by LF is dropped
  // (stray_cr). The field's end is the nearest comma or LF; a CR is looked for only inside that segment, so the
  // scan never runs past the field.
  function readUnquoted(value) {
    let added = 0;
    while (true) {
      const comma = text.indexOf(',', pos);
      const lf = text.indexOf('\n', pos);
      let end = n;
      let kind = END;
      if (comma !== -1) {
        end = comma;
        kind = COMMA;
      }
      if (lf !== -1 && lf < end) {
        end = lf;
        kind = LINE_BREAK;
      }
      // A CR just before the LF is the CRLF that ends the field, not a stray CR.
      // Look for a lone CR by scanning the segment itself: it is short, and an
      // unbounded indexOf would walk far past the field on files with few CRs.
      let segEnd = end;
      if (kind === LINE_BREAK && end > pos && text.charCodeAt(end - 1) === 13) segEnd = end - 1;
      let cr = -1;
      for (let i = pos; i < segEnd; i++) {
        if (text.charCodeAt(i) === 13) {
          cr = i - pos;
          break;
        }
      }
      if (cr === -1) {
        if (segEnd > pos) {
          value += text.slice(pos, segEnd);
          added += segEnd - pos;
        }
        if (kind === COMMA) {
          pos = end + 1;
        } else if (kind === LINE_BREAK) {
          pos = end + 1;
          line += 1;
        } else {
          pos = n;
        }
        fValue = value;
        fEnded = kind;
        fAdded = added;
        return;
      }
      // A lone CR inside the segment: drop it (stray_cr) and keep reading the field.
      if (cr > 0) {
        value += text.slice(pos, pos + cr);
        added += cr;
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      pos = pos + cr + 1;
    }
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    // Find the closing quote: the first quote whose next character is not a quote.
    let close = -1;
    let q = open + 1;
    while (true) {
      const idx = text.indexOf('"', q);
      if (idx === -1) break;
      if (text.charCodeAt(idx + 1) === 34) {
        q = idx + 2;
        continue;
      }
      close = idx;
      break;
    }
    if (close === -1) {
      // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      readUnquoted('"');
      return;
    }
    let value = text.slice(open + 1, close);
    if (value.indexOf('\r') !== -1 || value.indexOf('\n') !== -1) {
      // Each CRLF or lone CR inside quotes is one LF, and each counts one line.
      let breaks = 0;
      for (let i = 0; i < value.length; i++) {
        const cc = value.charCodeAt(i);
        if (cc === 10) breaks += 1;
        else if (cc === 13) {
          breaks += 1;
          if (value.charCodeAt(i + 1) === 10) i += 1;
        }
      }
      line += breaks;
      value = value.replace(/\r\n?/g, '\n');
    }
    if (value.indexOf('"') !== -1) value = value.replaceAll('""', '"');
    pos = close + 1;
    if (pos >= n) {
      fValue = value;
      fEnded = END;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fValue = value;
      fEnded = COMMA;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fValue = value;
      fEnded = LINE_BREAK;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fValue = value;
      fEnded = LINE_BREAK;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the next comma or line break.
    readUnquoted(value);
    if (fAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: a record whose first line holds no quote and no stray CR ends at
    // its first line break, and its fields are the line split on commas. A CR is
    // only a CRLF at the end of the line; a lone CR at the end of the last line
    // (no line break after it) is a stray CR, so it takes the slow path.
    const nl = text.indexOf('\n', pos);
    let lineEnd = nl === -1 ? n : nl;
    // A quote anywhere in the line takes the slow path; quotes are dense, so this scan is short.
    const q = text.indexOf('"', pos);
    let fast = false;
    if (q === -1 || q >= lineEnd) {
      // No quote in this line: look for a CR only inside the line, never past it
      // (stray CRs are rare, so an unbounded scan would walk far past the record).
      const crInLine = text.slice(pos, lineEnd).indexOf('\r');
      if (crInLine === -1) fast = true;
      else if (nl !== -1 && crInLine === lineEnd - pos - 1) {
        // The line's only CR is the CRLF at its end.
        lineEnd -= 1;
        fast = true;
      }
    }
    if (fast) {
      if (lineEnd === pos) {
        // An empty line: no record (the skip loop above normally takes these).
        if (nl === -1) break;
        pos = nl + 1;
        line += 1;
        continue;
      }
      const fields = [];
      let fpos = pos;
      while (true) {
        const c = text.indexOf(',', fpos);
        if (c === -1 || c >= lineEnd) {
          fields.push(text.slice(fpos, lineEnd));
          break;
        }
        fields.push(text.slice(fpos, c));
        fpos = c + 1;
      }
      if (nl === -1) pos = n;
      else {
        pos = nl + 1;
        line += 1;
      }
      if (width < 0) width = fields.length;
      if (header && columns === null) {
        columns = fields;
        continue;
      }
      if (fields.length < width) {
        errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
        while (fields.length < width) fields.push('');
      } else if (fields.length > width) {
        errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
      }
      rows.push(fields);
      continue;
    }

    // Slow path: the record holds a quote or a stray CR; read it field by field.
    const fields = [];
    let quoted = false;
    while (true) {
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        readQuoted();
      } else {
        quoted = false;
        readUnquoted('');
      }
      fields.push(fValue);
      if (fEnded !== COMMA) break;
    }

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
